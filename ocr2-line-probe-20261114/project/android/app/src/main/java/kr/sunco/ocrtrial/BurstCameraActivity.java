package kr.sunco.ocrtrial;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.MediaStore;
import android.graphics.*;
import android.hardware.camera2.*;
import android.media.ImageReader;
import android.media.Image;
import android.util.Size;
import android.view.*;
import android.widget.*;
import java.util.*;
import java.io.*;
import java.nio.ByteBuffer;

/** Separate trial-only camera; no network or certification operations. */
public class BurstCameraActivity extends Activity {
    OrientationEventListener orientationListener; int deviceDegrees=0;
    final ArrayList<Uri> captured=new ArrayList<>();
    LinearLayout body,controls;FrameLayout cameraViewport,cameraFrame;
    TextureView preview;TextView count,notice,portraitHint;Button shoot,finish;
    HandlerThread thread;Handler background;CameraDevice device;CameraCaptureSession session;ImageReader reader;
    CameraCharacteristics characteristics;Surface previewSurface;boolean saving=false,resumed=false;int galleryFailures=0;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
        orientationListener=new OrientationEventListener(this){public void onOrientationChanged(int angle){if(angle!=ORIENTATION_UNKNOWN)deviceDegrees=((angle+45)/90*90)%360;}};
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(state!=null){ArrayList<String> values=state.getStringArrayList("captured");if(values!=null)for(String s:values)captured.add(Uri.parse(s));galleryFailures=state.getInt("galleryFailures",0);}
        LinearLayout root=new LinearLayout(this);root.setOrientation(1);root.setBackgroundColor(0xff142d25);setContentView(root);SafeInsets.apply(root,8);
        body=new LinearLayout(this);root.addView(body,new LinearLayout.LayoutParams(-1,0,1));
        cameraViewport=new FrameLayout(this);cameraViewport.setBackgroundColor(0xff091a15);body.addView(cameraViewport);
        cameraFrame=new FrameLayout(this);
        cameraViewport.addView(cameraFrame,new FrameLayout.LayoutParams(-1,-1,Gravity.CENTER));
        portraitHint=new TextView(this);portraitHint.setTextColor(0xffffe5a3);portraitHint.setTextSize(15);portraitHint.setText("출고봉투는 가로로 촬영해주세요.");root.addView(portraitHint,0);
        preview=new TextureView(this);cameraFrame.addView(preview,new FrameLayout.LayoutParams(-1,-1,Gravity.CENTER));
        cameraFrame.addView(new DocumentGuide(this),new FrameLayout.LayoutParams(-1,-1));

        count=new TextView(this);
        count.setTextColor(Color.WHITE);
        count.setTextSize(16);
        count.setPadding(dp(10),dp(4),dp(10),dp(4));
        count.setBackgroundColor(0xdd142d25);
        FrameLayout.LayoutParams countLayout=new FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.CENTER_HORIZONTAL);
        countLayout.topMargin=dp(8);
        cameraFrame.addView(count,countLayout);

        notice=new TextView(this);
        notice.setTextColor(Color.WHITE);
        notice.setTextSize(14);
        notice.setGravity(Gravity.CENTER);
        notice.setShadowLayer(dp(3),0,dp(1),Color.BLACK);
        FrameLayout.LayoutParams noticeLayout=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        noticeLayout.setMargins(dp(8),0,dp(8),dp(8));
        cameraFrame.addView(notice,noticeLayout);
        controls=new LinearLayout(this);controls.setOrientation(1);controls.setGravity(Gravity.CENTER);body.addView(controls);
        cameraViewport.addOnLayoutChangeListener((v,l,t,rr,b,ol,ot,or,ob)->fitPreview());
        shoot=new Button(this);shoot.setText("촬영");shoot.setEnabled(false);shoot.setTextColor(0xff142d25);shoot.setTextSize(16);shoot.setPadding(0,0,0,0);shoot.setMinWidth(0);shoot.setMinimumWidth(0);shoot.setMinHeight(0);shoot.setMinimumHeight(0);
        android.graphics.drawable.GradientDrawable circle=new android.graphics.drawable.GradientDrawable();circle.setShape(android.graphics.drawable.GradientDrawable.OVAL);circle.setColor(0xffffffff);circle.setStroke(dp(4),0xffa9c8b7);shoot.setBackground(circle);
        LinearLayout.LayoutParams shutterLayout=new LinearLayout.LayoutParams(dp(80),dp(80));shutterLayout.gravity=Gravity.CENTER_HORIZONTAL;shutterLayout.topMargin=dp(8);shutterLayout.bottomMargin=dp(8);controls.addView(shoot,shutterLayout);shoot.setOnClickListener(v->takePhoto());
        finish=new Button(this);finish.setText("찍은 사진 인증하러 가기");finish.setTextColor(0xff142d25);finish.setMinHeight((int)(56*getResources().getDisplayMetrics().density));controls.addView(finish,new LinearLayout.LayoutParams(-1,-2));finish.setOnClickListener(v->returnPhotos());updateCount();layoutCamera();
        preview.setSurfaceTextureListener(new TextureView.SurfaceTextureListener(){
            public void onSurfaceTextureAvailable(SurfaceTexture s,int w,int h){if(resumed)openCamera();}
            public void onSurfaceTextureSizeChanged(SurfaceTexture s,int w,int h){transformPreview();}
            public boolean onSurfaceTextureDestroyed(SurfaceTexture s){return true;}
            public void onSurfaceTextureUpdated(SurfaceTexture s){}
        });
    }
    int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    @Override public void onConfigurationChanged(android.content.res.Configuration configuration){super.onConfigurationChanged(configuration);layoutCamera();}
    void layoutCamera(){
        boolean landscape=getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        portraitHint.setVisibility(landscape?View.GONE:View.VISIBLE);
        body.setOrientation(landscape?LinearLayout.HORIZONTAL:LinearLayout.VERTICAL);
        cameraViewport.setLayoutParams(landscape?new LinearLayout.LayoutParams(0,-1,1):new LinearLayout.LayoutParams(-1,0,1));
        controls.setLayoutParams(landscape?new LinearLayout.LayoutParams(dp(144),-1):new LinearLayout.LayoutParams(-1,-2));
        finish.setTextSize(landscape?13:16);cameraViewport.post(()->fitPreview());
    }
    void fitPreview(){
        if(previewSize==null||cameraViewport.getWidth()==0||cameraViewport.getHeight()==0)return;
        int rotation=getWindowManager().getDefaultDisplay().getRotation();
        Integer sensor=characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);
        boolean swap=(((sensor==null?90:sensor)-rotation*90+360)%180)!=0;
        float ratio=swap?(float)previewSize.getHeight()/previewSize.getWidth():(float)previewSize.getWidth()/previewSize.getHeight();
        // Fit the preview and its guide together without clipping camera pixels.
        int w=cameraViewport.getWidth(),h=Math.max(1,Math.round(w/ratio));
        if(h>cameraViewport.getHeight()){
            h=cameraViewport.getHeight();
            w=Math.max(1,Math.round(h*ratio));
        }
        FrameLayout.LayoutParams params=(FrameLayout.LayoutParams)cameraFrame.getLayoutParams();
        if(params.width!=w||params.height!=h){
            params.width=w;
            params.height=h;
            cameraFrame.setLayoutParams(params);
        }
        preview.post(()->transformPreview());
    }
    class DocumentGuide extends View {
        final Paint pen=new Paint(Paint.ANTI_ALIAS_FLAG);
        DocumentGuide(Context context){super(context);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
        @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);
            RectF rect=GuideGeometry.frame(getWidth(),getHeight());
            pen.setStyle(Paint.Style.STROKE);pen.setStrokeWidth(dp(2));pen.setColor(0xddffffff);canvas.drawRoundRect(rect,dp(8),dp(8),pen);
        }
    }
    void updateCount(){count.setText(captured.size()+"장 촬영됨");finish.setEnabled(!saving&&!captured.isEmpty());}
    @Override protected void onResume(){super.onResume();resumed=true;if(orientationListener.canDetectOrientation())orientationListener.enable();thread=new HandlerThread("trial-camera");thread.start();background=new Handler(thread.getLooper());if(preview.isAvailable())openCamera();}
    @Override protected void onPause(){resumed=false;orientationListener.disable();closeCamera();if(thread!=null){thread.quitSafely();thread=null;}super.onPause();}
    @Override public void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);ArrayList<String> values=new ArrayList<>();for(Uri u:captured)values.add(u.toString());state.putStringArrayList("captured",values);state.putInt("galleryFailures",galleryFailures);}
    Size previewSize; float[] pendingGuide;
    void openCamera(){
        if(device!=null||checkSelfPermission(android.Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)return;
        try{
            CameraManager manager=(CameraManager)getSystemService(CAMERA_SERVICE);String id=null;
            for(String candidate:manager.getCameraIdList()){CameraCharacteristics c=manager.getCameraCharacteristics(candidate);Integer facing=c.get(CameraCharacteristics.LENS_FACING);if(facing!=null&&facing==CameraCharacteristics.LENS_FACING_BACK){id=candidate;break;}}
            if(id==null)throw new IOException();characteristics=manager.getCameraCharacteristics(id);
            android.hardware.camera2.params.StreamConfigurationMap map=characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);if(map==null)throw new IOException();
            Size[] jpeg=map.getOutputSizes(ImageFormat.JPEG);if(jpeg==null||jpeg.length==0)throw new IOException();
            Size chosen=jpeg[0];long area=0;for(Size size:jpeg){long pixels=(long)size.getWidth()*size.getHeight();if(pixels<=13000000&&pixels>area){chosen=size;area=pixels;}}
            double target=(double)chosen.getWidth()/chosen.getHeight();Size[] sizes=map.getOutputSizes(SurfaceTexture.class);if(sizes==null||sizes.length==0)throw new IOException();previewSize=sizes[0];double best=Double.MAX_VALUE;
            for(Size size:sizes){double score=Math.abs((double)size.getWidth()/size.getHeight()-target)*100+Math.abs(size.getWidth()-1280)/1280.;if(score<best&&size.getWidth()<=1920){best=score;previewSize=size;}}
            reader=ImageReader.newInstance(chosen.getWidth(),chosen.getHeight(),ImageFormat.JPEG,2);reader.setOnImageAvailableListener(r->saveImage(r),background);
            manager.openCamera(id,new CameraDevice.StateCallback(){
                public void onOpened(CameraDevice camera){if(!resumed){camera.close();return;}device=camera;startPreview();}
                public void onDisconnected(CameraDevice camera){camera.close();device=null;cameraError("카메라 연결이 끊겼습니다. 화면으로 돌아간 뒤 다시 열어주세요.");}
                public void onError(CameraDevice camera,int error){camera.close();device=null;cameraError("카메라를 열지 못했습니다. 오류 코드 "+error);}
            },background);
        }catch(Exception e){cameraError("카메라를 시작하지 못했습니다. 사진 가져오기를 이용해주세요.");}
    }
    void startPreview(){
        try{
            SurfaceTexture texture=preview.getSurfaceTexture();if(texture==null||device==null)return;texture.setDefaultBufferSize(previewSize.getWidth(),previewSize.getHeight());previewSurface=new Surface(texture);
            device.createCaptureSession(Arrays.asList(previewSurface,reader.getSurface()),new CameraCaptureSession.StateCallback(){
                public void onConfigured(CameraCaptureSession configured){if(device==null||!resumed){configured.close();return;}session=configured;
                    try{CaptureRequest.Builder request=device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);request.addTarget(previewSurface);request.set(CaptureRequest.CONTROL_AF_MODE,CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);session.setRepeatingRequest(request.build(),null,background);runOnUiThread(()->{fitPreview();shoot.setEnabled(!saving);});}catch(Exception e){cameraError("카메라 미리보기를 시작하지 못했습니다.");}}
                public void onConfigureFailed(CameraCaptureSession failed){cameraError("카메라 미리보기를 시작하지 못했습니다.");}
            },background);
        }catch(Exception e){cameraError("카메라 미리보기를 열지 못했습니다.");}
    }
    void transformPreview(){
        if(previewSize==null||preview.getWidth()==0||preview.getHeight()==0)return;
        int rotation=getWindowManager().getDefaultDisplay().getRotation();float w=preview.getWidth(),h=preview.getHeight();Matrix m=new Matrix();
        if(rotation==Surface.ROTATION_90||rotation==Surface.ROTATION_270){RectF view=new RectF(0,0,w,h),buffer=new RectF(0,0,previewSize.getHeight(),previewSize.getWidth());buffer.offset(view.centerX()-buffer.centerX(),view.centerY()-buffer.centerY());m.setRectToRect(view,buffer,Matrix.ScaleToFit.FILL);float scale=Math.max(h/previewSize.getHeight(),w/previewSize.getWidth());m.postScale(scale,scale,w/2,h/2);m.postRotate(90*(rotation-2),w/2,h/2);}
        else if(rotation==Surface.ROTATION_180)m.postRotate(180,w/2,h/2);
        preview.setTransform(m);
    }
    void takePhoto(){
        if(saving||session==null||device==null)return;saving=true;shoot.setEnabled(false);updateCount();notice.setText("사진 저장 중");
        try{
            CaptureRequest.Builder request=device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);request.addTarget(reader.getSurface());request.set(CaptureRequest.CONTROL_AF_MODE,CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            Integer sensor=characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);
            int jpegRotation=((sensor==null?90:sensor)+deviceDegrees+360)%360;
            request.set(CaptureRequest.JPEG_ORIENTATION,jpegRotation);
            pendingGuide=GuideGeometry.map(GuideGeometry.frame(cameraFrame.getWidth(),cameraFrame.getHeight()),
                preview.getLeft(),preview.getTop(),preview.getWidth(),preview.getHeight(),preview.getTransform(new Matrix()),jpegRotation);
            session.capture(request.build(),new CameraCaptureSession.CaptureCallback(){@Override public void onCaptureFailed(CameraCaptureSession s,CaptureRequest r,CaptureFailure failure){captureError("사진을 촬영하지 못했습니다. 다시 눌러주세요.");}},background);
        }catch(Exception e){captureError("사진을 촬영하지 못했습니다. 다시 눌러주세요.");}
    }
    void saveImage(ImageReader source){
        Uri gallery=null;java.io.File file=null;
        try(Image image=source.acquireNextImage()){
            if(image==null)return;ByteBuffer buffer=image.getPlanes()[0].getBuffer();byte[] bytes=new byte[buffer.remaining()];buffer.get(bytes);
            try{GuideStore.put(this,bytes,pendingGuide);}catch(Exception ignored){}
            java.io.File folder=new java.io.File(getFilesDir(),"camera");if(!folder.exists()&&!folder.mkdirs())throw new IOException();file=java.io.File.createTempFile("burst-",".jpg",folder);try(FileOutputStream out=new FileOutputStream(file)){out.write(bytes);}
            Uri local=androidx.core.content.FileProvider.getUriForFile(this,getPackageName()+".camera",file);
            final boolean saved=true;final Uri selected=local;
            runOnUiThread(()->{captured.add(selected);if(!saved)galleryFailures++;saving=false;updateCount();shoot.setEnabled(session!=null);notice.setText(saved?"시험 앱 안에 저장됐습니다. 다음 사진을 촬영하세요.":"앱에 보관됐습니다. 갤러리 저장은 실패했습니다.");});
        }catch(Exception e){captureError("사진 저장에 실패했습니다. 다시 촬영해주세요.");}
    }
    void captureError(String message){runOnUiThread(()->{saving=false;updateCount();shoot.setEnabled(session!=null);notice.setText(message);});}
    void cameraError(String message){runOnUiThread(()->{shoot.setEnabled(false);notice.setText(message);});}
    void returnPhotos(){if(saving||captured.isEmpty())return;Intent data=new Intent();data.putExtra("captureRequest",getIntent().getStringExtra("captureRequest"));ClipData clip=ClipData.newRawUri("촬영 사진",captured.get(0));for(int n=1;n<captured.size();n++)clip.addItem(new ClipData.Item(captured.get(n)));data.setClipData(clip);data.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);setResult(RESULT_OK,data);finish();}
    void exitCamera(){setResult(RESULT_CANCELED);finish();}
    @Override public void onBackPressed(){
        if(saving){notice.setText("사진 저장이 끝날 때까지 잠시 기다려주세요.");return;}
        if(captured.isEmpty()){exitCamera();return;}
        new AlertDialog.Builder(this).setTitle("촬영을 마칠까요?")
            .setMessage("찍은 "+captured.size()+"장의 원본은 보관됩니다. 촬영 나가기를 누르면 인증하지 않고 앱으로 돌아갑니다.")
            .setPositiveButton("촬영 나가기",(d,w)->exitCamera())
            .setNeutralButton("찍은 사진 인증하러 가기",(d,w)->returnPhotos())
            .setNegativeButton("계속 촬영",null).show();
    }
    void closeCamera(){if(session!=null){session.close();session=null;}if(device!=null){device.close();device=null;}if(reader!=null&&!saving){reader.close();reader=null;}if(previewSurface!=null){previewSurface.release();previewSurface=null;}}
}
