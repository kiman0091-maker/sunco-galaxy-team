package kr.sunco.ocrtrial;

import android.app.*;
import android.os.*;
import android.content.*;
import android.net.Uri;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.util.concurrent.*;
import org.json.*;

/** Native camera/OCR with the existing authenticated website workflow. */
public class WebEntryActivity extends Activity {
    // Dedicated R11 lab only; a future approved device test requires USB reverse.
    static final String ORIGIN="https://localhost:18443";
    WebView web;boolean trusted=false,destroyed=false,requestValid=false,captureValid=false,pickerBusy=false;String requestId,captureId;boolean capturePermissionPending;File requestFile;
    int pageGeneration=0,requestPage,capturePage;
    ValueCallback<Uri[]> picker;final ExecutorService io=Executors.newSingleThreadExecutor();
    String policy,bridge;
    @Override public void onCreate(Bundle state){super.onCreate(state);
        web=new WebView(this);setContentView(web);SafeInsets.apply(web,0);
        web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(true);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        try{policy=asset("native-policy.js");bridge=asset("native-integration.js")+"\n"+asset("manual-review.js");}catch(IOException error){finish();return;}
        web.addJavascriptInterface(new NativeActions(),"SuncoAndroid");
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){invalidatePending();pageGeneration++;trusted=false;}
            @Override public void onPageFinished(WebView view,String url){trusted=allowed(url);if(trusted)view.evaluateJavascript(policy+"\n"+bridge,null);}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();if(allowed(url))return false;
                // Test preparation never opens an external browser or real business site.
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String scheme=request.getUrl().getScheme();
                if(("https".equalsIgnoreCase(scheme)||"http".equalsIgnoreCase(scheme))&&!allowed(request.getUrl().toString()))
                    return new WebResourceResponse("text/plain","UTF-8",403,"R11 external connection blocked",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
                return null;
            }
            @Override public void onReceivedHttpAuthRequest(WebView view,HttpAuthHandler handler,String host,String realm){
                if(!host.equals(Uri.parse(ORIGIN).getHost())){handler.cancel();return;}
                LinearLayout panel=new LinearLayout(WebEntryActivity.this);panel.setOrientation(1);panel.setPadding(32,16,32,16);
                EditText name=new EditText(WebEntryActivity.this);name.setText("tester");name.setHint("접속 아이디");panel.addView(name);
                EditText password=new EditText(WebEntryActivity.this);password.setHint("앱 접속 비밀번호");password.setInputType(129);panel.addView(password);
                new AlertDialog.Builder(WebEntryActivity.this).setTitle("기존 앱 접속 인증").setView(panel).setPositiveButton("접속",(d,w)->handler.proceed(name.getText().toString(),password.getText().toString())).setNegativeButton("닫기",(d,w)->handler.cancel()).setOnCancelListener(d->handler.cancel()).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(!trusted||pickerBusy)return false;pickerBusy=true;picker=callback;
                Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);pick.setType("image/*");pick.addCategory(Intent.CATEGORY_OPENABLE);pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);startActivityForResult(pick,81);return true;
            }
        });
        web.loadUrl(ORIGIN+"/");
    }
    boolean allowed(String value){try{Uri uri=Uri.parse(value),origin=Uri.parse(ORIGIN);int port=uri.getPort()==-1?443:uri.getPort(),expected=origin.getPort()==-1?443:origin.getPort();return "https".equalsIgnoreCase(uri.getScheme())&&uri.getUserInfo()==null&&origin.getHost().equalsIgnoreCase(uri.getHost())&&port==expected;}catch(Exception error){return false;}}
    byte[] readBytes(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[65536];int count,total=0;while((count=in.read(buffer))!=-1){total+=count;if(total>21000000)throw new IOException();out.write(buffer,0,count);}return out.toByteArray();}
    String asset(String name)throws IOException{try(InputStream in=getAssets().open(name)){return new String(readBytes(in),java.nio.charset.StandardCharsets.UTF_8);}}
    boolean validId(String id){return id!=null&&id.matches("[a-f0-9]{32}");}
    void invalidatePending(){requestValid=false;captureValid=false;if(picker!=null){picker.onReceiveValue(null);picker=null;}}
    void startCapture(String id){if(!trusted||destroyed||captureId!=null||!validId(id))return;
        captureId=id;captureValid=true;capturePage=pageGeneration;
        if(checkSelfPermission(android.Manifest.permission.CAMERA)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
            capturePermissionPending=true;
            requestPermissions(new String[]{android.Manifest.permission.CAMERA},91);
            return;
        }
        launchCapture(id);
    }
    void launchCapture(String id){
        startActivityForResult(new Intent(this,BurstCameraActivity.class).putExtra("captureRequest",id),82);
    }
    class NativeActions {
        @JavascriptInterface public int getProtocolVersion(){return 2;}
        @JavascriptInterface public void cancelPending(){runOnUiThread(()->invalidatePending());}
        @JavascriptInterface public void capture(String id){runOnUiThread(()->startCapture(id));}
        @JavascriptInterface public void recognize(String id,String encoded){recognizeInternal(id,encoded,false);}
        @JavascriptInterface public void recognizeName(String id,String encoded){recognizeInternal(id,encoded,true);}
        void recognizeInternal(String id,String encoded,boolean nameOnly){
            runOnUiThread(()->{if(!trusted||destroyed||requestId!=null||!validId(id)||encoded==null||encoded.length()>28000000)return;
                requestId=id;requestValid=true;requestPage=pageGeneration;final int page=requestPage;
                io.execute(()->{File image=null;try{
                    byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);image=File.createTempFile("native-ocr-",".jpg",getCacheDir());try(FileOutputStream out=new FileOutputStream(image)){out.write(bytes);}
                    float[] savedGuide=null;try{savedGuide=GuideStore.get(WebEntryActivity.this,bytes);}catch(Exception ignored){}
                    final float[] guide=savedGuide;final File prepared=image;
                    Uri uri=androidx.core.content.FileProvider.getUriForFile(WebEntryActivity.this,getPackageName()+".camera",prepared);
                    runOnUiThread(()->{if(destroyed||!trusted||!requestValid||page!=pageGeneration||!id.equals(requestId)){prepared.delete();if(id.equals(requestId))clearRequest();return;}
                        requestFile=prepared;Intent intent=new Intent(WebEntryActivity.this,MainActivity.class);intent.setData(uri);intent.putExtra("nativeRequest",true);intent.putExtra("nativeRequestId",id);intent.putExtra("nameOnly",nameOnly);if(guide!=null&&!nameOnly)intent.putExtra("guideRect",guide);startActivityForResult(intent,83);});
                }catch(Exception error){if(image!=null)image.delete();runOnUiThread(()->reply(id,"{}"));}});
            });
        }
    }
    void clearRequest(){requestId=null;requestValid=false;if(requestFile!=null){requestFile.delete();requestFile=null;}}
    void reply(String returnedId,String value){String id=requestId;if(id==null||!id.equals(returnedId))return;boolean deliver=requestValid&&trusted&&!destroyed&&requestPage==pageGeneration;clearRequest();if(!deliver)return;
        try{JSONObject result=new JSONObject(value);web.evaluateJavascript("window.suncoNativeResult&&window.suncoNativeResult("+JSONObject.quote(id)+","+result+")",null);}catch(Exception ignored){}
    }
    boolean currentCapture(String id,int page){return !destroyed&&trusted&&captureValid&&id!=null&&id.equals(captureId)&&page==pageGeneration;}
    void finishCapture(String id,int page,String method){if(currentCapture(id,page))web.evaluateJavascript("window.suncoCapturePhotos&&window.suncoCapturePhotos."+method+"("+JSONObject.quote(id)+")",null);if(id!=null&&id.equals(captureId)){captureId=null;captureValid=false;}}
    static Uri[] selectedPhotos(int result,Intent data){
        if(result!=RESULT_OK||data==null)return null;
        java.util.ArrayList<Uri> photos=new java.util.ArrayList<>();
        ClipData clip=data.getClipData();
        if(clip!=null)for(int i=0;i<clip.getItemCount();i++){Uri uri=clip.getItemAt(i).getUri();if(uri!=null&&!photos.contains(uri))photos.add(uri);}
        if(data.getData()!=null&&!photos.contains(data.getData()))photos.add(data.getData());
        return photos.isEmpty()?null:photos.toArray(new Uri[0]);
    }
    @Override public void onRequestPermissionsResult(int code,String[] names,int[] results){super.onRequestPermissionsResult(code,names,results);if(code!=91||!capturePermissionPending)return;
        capturePermissionPending=false;String id=captureId;int page=capturePage;
        if(currentCapture(id,page)&&results.length>0&&results[0]==android.content.pm.PackageManager.PERMISSION_GRANTED){
            launchCapture(id);
        }else finishCapture(id,page,"error");
    }
    @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);
        if(code==81){ValueCallback<Uri[]> callback=picker;picker=null;pickerBusy=false;if(callback!=null)callback.onReceiveValue(trusted&&!destroyed?selectedPhotos(result,data):null);return;}
        if(code==83){String id=data==null?null:data.getStringExtra("nativeRequestId");if(result!=RESULT_OK){id=requestId;}reply(id,result==RESULT_OK&&data!=null?data.getStringExtra("result"):"{\"cancelled\":true}");return;}
        if(code==82){final String id=captureId;final int page=capturePage;Uri[] photos=selectedPhotos(result,data);
            if(capturePermissionPending)return;
            if(!currentCapture(id,page)){finishCapture(id,page,"done");return;}
            if(result!=RESULT_OK){finishCapture(id,page,"done");return;}
            if(data==null){finishCapture(id,page,"error");return;}
            if(!id.equals(data.getStringExtra("captureRequest")))return;
            if(photos==null){finishCapture(id,page,"error");return;}
            io.execute(()->{try{for(int n=0;n<photos.length;n++){byte[] bytes;try(InputStream in=getContentResolver().openInputStream(photos[n])){bytes=readBytes(in);}if(bytes.length>20000000)throw new IOException();String encoded=android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP);String name="썬쿠_"+System.currentTimeMillis()+"_"+n+".jpg";
                runOnUiThread(()->{if(currentCapture(id,page))web.evaluateJavascript("window.suncoCapturePhotos&&window.suncoCapturePhotos.add("+JSONObject.quote(encoded)+","+JSONObject.quote(name)+","+JSONObject.quote(id)+")",null);});}
                runOnUiThread(()->finishCapture(id,page,"done"));
            }catch(Exception error){runOnUiThread(()->finishCapture(id,page,"error"));}});
        }
    }
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){destroyed=true;invalidatePending();web.removeJavascriptInterface("SuncoAndroid");web.destroy();io.shutdown();super.onDestroy();}
}
