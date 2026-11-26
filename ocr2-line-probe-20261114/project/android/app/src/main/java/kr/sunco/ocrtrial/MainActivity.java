package kr.sunco.ocrtrial;

import android.app.*;
import android.os.*;
import android.content.*;
import android.net.Uri;
import android.provider.MediaStore;
import android.graphics.Rect;
import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.view.*;
import android.widget.*;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.*;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {

    // Observations share only this exact, unrotated field bitmap coordinate system.
    // No claim is made that crop-local coordinates are original-photo coordinates.
    org.json.JSONArray contractSymbolPasses=new org.json.JSONArray();
    Bitmap contractSymbolCrop;
    String contractSymbolScope="";
    boolean contractSymbolInvalid;
    int contractSymbolGeneration,contractSymbolLastAttempt=-1;
    org.json.JSONArray contractSymbolDiagnostics=new org.json.JSONArray();
    void symbolDiagnostic(int attempt,String code){
        try{contractSymbolDiagnostics.put(new org.json.JSONObject().put("attempt",attempt).put("code",code));}catch(Exception ignored){}
    }
    void resetContractSymbols(){contractSymbolPasses=new org.json.JSONArray();contractSymbolCrop=null;contractSymbolScope="";contractSymbolInvalid=false;contractSymbolGeneration++;contractSymbolLastAttempt=-1;contractSymbolDiagnostics=new org.json.JSONArray();}
    static org.json.JSONObject symbolPass(Text text,int width,int height,int inputWidth,int inputHeight,int attempt)throws Exception{
        if(width<=0||height<=0||inputWidth<=48||inputHeight<=48)throw new IllegalArgumentException("geometry");
        List<Text.Element> matches=new ArrayList<>();
        for(Text.TextBlock block:text.getTextBlocks())for(Text.Line line:block.getLines())for(Text.Element e:line.getElements())
            if(e.getText().matches("[A-Z0-9]{13}"))matches.add(e);
        if(matches.isEmpty())throw new IllegalArgumentException("missing row");
        if(matches.size()!=1)throw new IllegalArgumentException("ambiguous row");
        Text.Element row=matches.get(0);List<Text.Symbol> symbols=row.getSymbols();
        if(symbols.size()!=13)throw new IllegalArgumentException("symbol count");
        double sx=(double)width/(inputWidth-48),sy=(double)height/(inputHeight-48);
        org.json.JSONArray letters=new org.json.JSONArray();StringBuilder joined=new StringBuilder();
        double previousRight=-1;
        for(int i=0;i<13;i++){
            Text.Symbol symbol=symbols.get(i);String raw=symbol.getText();Rect box=symbol.getBoundingBox();
            if(!raw.matches("[A-Z0-9]")||box==null||box.left<24||box.top<24||box.right>inputWidth-24||box.bottom>inputHeight-24||box.right<=box.left||box.bottom<=box.top)throw new IllegalArgumentException("symbol geometry");
            double left=(box.left-24)*sx,top=(box.top-24)*sy,right=(box.right-24)*sx,bottom=(box.bottom-24)*sy;
            if(left<previousRight)throw new IllegalArgumentException("overlapping symbols");previousRight=right;joined.append(raw);
            letters.put(new org.json.JSONObject().put("index",i).put("char",raw)
                .put("rawBox",new org.json.JSONArray(new int[]{box.left,box.top,box.right,box.bottom}))
                .put("box",new org.json.JSONArray(new double[]{left,top,right,bottom})));
        }
        if(!joined.toString().equals(row.getText()))throw new IllegalArgumentException("text alignment");
        return new org.json.JSONObject().put("id","contract-"+attempt).put("text",joined.toString())
            .put("width",width).put("height",height).put("inputWidth",inputWidth).put("inputHeight",inputHeight)
            .put("inverse",new org.json.JSONArray(new double[]{sx,sy,-24*sx,-24*sy})).put("symbols",letters);
    }
    void collectContractSymbols(Text text,Bitmap crop,Bitmap input,int attempt,boolean leveled,int generation){
        if(generation!=contractSymbolGeneration)return; // An old task must not mutate the current task.
        if(leveled)return; // No proven inverse rotation: keep this path excluded.
        if(attempt<0||attempt>2||attempt<=contractSymbolLastAttempt){contractSymbolInvalid=true;symbolDiagnostic(attempt,"PASS_ID");return;}
        if(contractSymbolCrop==null){
            if(attempt!=0){contractSymbolInvalid=true;symbolDiagnostic(attempt,"MISSING_START");return;}
            contractSymbolCrop=crop;contractSymbolScope=UUID.randomUUID().toString();
        }
        if(contractSymbolCrop!=crop){contractSymbolInvalid=true;symbolDiagnostic(attempt,"CROP_ID");return;}
        contractSymbolLastAttempt=attempt;
        try{contractSymbolPasses.put(symbolPass(text,crop.getWidth(),crop.getHeight(),input.getWidth(),input.getHeight(),attempt));symbolDiagnostic(attempt,"OK");}
        catch(Exception error){
            String cause=error.getMessage(),code="INVALID_OBSERVATION";
            if("missing row".equals(cause))code="ROW_MISSING";
            else if("symbol count".equals(cause))code="SYMBOL_COUNT";
            else contractSymbolInvalid=true; // Ambiguous rows, geometry and unexpected failures remain fatal.
            symbolDiagnostic(attempt,code);
        }
    }
    org.json.JSONObject contractSymbolEvidence(){
        try{
            java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
            try(java.io.InputStream in=getContentResolver().openInputStream(getIntent().getData())){
                if(in==null)return null;byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);
            }
            StringBuilder photo=new StringBuilder();for(byte b:digest.digest())photo.append(String.format(Locale.ROOT,"%02x",b&255));
            return new org.json.JSONObject().put("version",1).put("source","mlkit-symbols-v1").put("photo",photo.toString())
                .put("coordinateSpace","contract-crop-local").put("cropId",contractSymbolScope)
                .put("valid",!contractSymbolInvalid&&contractSymbolPasses.length()>=2).put("passes",contractSymbolPasses).put("diagnostics",contractSymbolDiagnostics);
        }catch(Exception ignored){return null;}
    }

    // Diagnostic-only: never feeds recognition, candidates, or certification.
    final String visualRequestScope=UUID.randomUUID().toString();
    String visualPhoto="";
    final org.json.JSONArray regionEvents=new org.json.JSONArray();
    void regionEvent(String message){
        if(VisualStore.allowed(visualPhoto)&&regionEvents.length()<40)regionEvents.put(message);
    }
    final org.json.JSONArray visualReports=new org.json.JSONArray();
    static final class VisualStore {
        static final long MAX_BYTES=32L*1024*1024,MAX_FILE=4L*1024*1024,TIME_MS=1500;
        static final String APPROVED="daa952587979392ac755c0139328ab40a23872d0e5ccc3edbbc84306f336b9a9";
        static boolean allowed(String photo){return APPROVED.equals(photo);}
        static String hash(byte[] bytes)throws Exception{
            byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder s=new StringBuilder();for(byte b:digest)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();
        }
        static long used(java.io.File dir)throws Exception{
            if(!dir.exists())return 0;long bytes=0;java.io.File[] files=dir.listFiles();
            if(files==null)throw new java.io.IOException("LIST");
            for(java.io.File f:files){if(java.nio.file.Files.isSymbolicLink(f.toPath()))throw new java.io.IOException("LINK");bytes+=f.isDirectory()?used(f):f.length();if(bytes>MAX_BYTES)return bytes;}
            return bytes;
        }
        static void fresh(java.io.File file,byte[] bytes)throws Exception{
            try(java.io.OutputStream out=java.nio.file.Files.newOutputStream(file.toPath(),java.nio.file.StandardOpenOption.CREATE_NEW,java.nio.file.StandardOpenOption.WRITE)){out.write(bytes);}
        }
        static org.json.JSONObject item(String name,byte[] data)throws Exception{return new org.json.JSONObject().put("name",name).put("bytes",data.length).put("sha256",hash(data));}
        // Time checks are cooperative; an individual filesystem/PNG operation cannot be pre-empted.
        static synchronized String write(java.io.File root,String photo,String request,int generation,int pass,
                byte[] input,byte[] overlay,byte[] metadata,long started,java.util.function.LongSupplier now)throws Exception{
            if(!allowed(photo)||request==null||!request.matches("[a-f0-9-]{36}")||generation<0||pass<0||pass>2)return "IDENTITY_REJECTED";
            if(now.getAsLong()-started>TIME_MS)return "TIME_LIMIT";
            if(input==null||overlay==null||metadata==null||input.length>MAX_FILE||overlay.length>MAX_FILE||metadata.length>256*1024)return "SIZE_LIMIT";
            if(java.nio.file.Files.isSymbolicLink(root.toPath()))throw new java.io.IOException("LINK");
            if(used(root)+input.length+overlay.length+metadata.length+8192>MAX_BYTES)return "STORAGE_LIMIT";
            java.io.File dir=new java.io.File(root,photo);if(!dir.isDirectory()&&!dir.mkdirs())throw new java.io.IOException("DIRECTORY");
            if(java.nio.file.Files.isSymbolicLink(root.toPath())||java.nio.file.Files.isSymbolicLink(dir.toPath()))throw new java.io.IOException("LINK");
            // Persistent claims cap this photo at three captures across Activity restarts. Never delete/reuse a claim.
            int slot=pass;java.io.File claim=new java.io.File(dir,"slot-"+slot+".claim");
            if(!claim.createNewFile())return "PHOTO_LIMIT";
            String prefix="slot-"+slot;
            if(now.getAsLong()-started>TIME_MS)return "TIME_LIMIT_CLAIMED";
            fresh(new java.io.File(dir,prefix+"-input.png"),input);
            if(now.getAsLong()-started>TIME_MS)return "TIME_LIMIT_PARTIAL";
            fresh(new java.io.File(dir,prefix+"-overlay.png"),overlay);
            fresh(new java.io.File(dir,prefix+"-coordinates.json"),metadata);
            org.json.JSONArray files=new org.json.JSONArray().put(item(prefix+"-input.png",input)).put(item(prefix+"-overlay.png",overlay)).put(item(prefix+"-coordinates.json",metadata));
            byte[] receipt=new org.json.JSONObject().put("photo",photo).put("diagnosticRequest",request).put("taskGeneration",generation).put("pass",pass).put("files",files)
                .put("elapsedMs",now.getAsLong()-started).put("budgetExceeded",now.getAsLong()-started>TIME_MS).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            fresh(new java.io.File(dir,prefix+"-receipt.json"),receipt);
            fresh(new java.io.File(dir,prefix+"-receipt.sha256"),hash(receipt).getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            return "SAVED:"+prefix+":"+hash(receipt);
        }
        static double[] map(double x,double y,int w,int h,int iw,int ih){
            if(w<=0||h<=0||iw<=48||ih<=48||!Double.isFinite(x)||!Double.isFinite(y))throw new IllegalArgumentException("GEOMETRY");
            return new double[]{(x-24)*w/(iw-48),(y-24)*h/(ih-48)};
        }
        static String corners(int[][] points,int width,int height){
            if(points==null)return "MISSING";if(points.length!=4)return "COUNT";
            long sign=0;
            for(int i=0;i<4;i++){
                int[] a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];
                if(a==null||b==null||c==null||a.length!=2||b.length!=2||c.length!=2)return "SHAPE";
                if(a[0]<0||a[1]<0||a[0]>width||a[1]>height)return "OUTSIDE";
                long cross=((long)b[0]-a[0])*(c[1]-b[1])-((long)b[1]-a[1])*(c[0]-b[0]);
                if(cross==0)return "DEGENERATE";if(sign!=0&&(cross>0)!=(sign>0))return "ORDER";sign=cross;
            }
            return "OK";
        }
    }
    void beginVisualDiagnostic(Uri uri){
        visualPhoto="";
        if(!getIntent().getBooleanExtra("visualDiagnostic",false))return;
        long start=SystemClock.elapsedRealtime();
        try(java.io.InputStream in=getContentResolver().openInputStream(uri)){
            if(in==null)return;java.security.MessageDigest md=java.security.MessageDigest.getInstance("SHA-256");
            byte[] b=new byte[8192];int n;long total=0;
            while((n=in.read(b))!=-1){total+=n;if(total>16*1024*1024||SystemClock.elapsedRealtime()-start>VisualStore.TIME_MS)return;md.update(b,0,n);}
            StringBuilder s=new StringBuilder();for(byte v:md.digest())s.append(String.format(Locale.ROOT,"%02x",v&255));
            if(VisualStore.allowed(s.toString()))visualPhoto=s.toString();
        }catch(Exception ignored){visualPhoto="";}
    }
    void visualDiagnostic(Text text,Bitmap input,Bitmap crop,int pass,boolean leveled,int generation,String photo){
        if(!guideFallback||leveled||generation!=contractSymbolGeneration||!VisualStore.allowed(photo)||!photo.equals(visualPhoto)||pass<0||pass>2||visualReports.length()>=3)return;
        long started=SystemClock.elapsedRealtime();Bitmap overlay=null;String outcome="FAILED";
        try{
            if((long)input.getWidth()*input.getHeight()>2_000_000){outcome="PIXEL_LIMIT";return;}
            overlay=input.copy(Bitmap.Config.ARGB_8888,true);if(overlay==null){outcome="COPY_FAILED";return;}
            Canvas canvas=new Canvas(overlay);Paint pen=new Paint();pen.setStyle(Paint.Style.STROKE);pen.setStrokeWidth(1);
            org.json.JSONArray symbols=new org.json.JSONArray();int element=0,count=0;
            if(text!=null)for(Text.TextBlock block:text.getTextBlocks())for(Text.Line line:block.getLines())for(Text.Element word:line.getElements()){
                int index=0;for(Text.Symbol symbol:word.getSymbols()){
                    if(++count>256){outcome="SYMBOL_LIMIT";return;}
                    Rect b=symbol.getBoundingBox();android.graphics.Point[] points=symbol.getCornerPoints();
                    org.json.JSONObject row=new org.json.JSONObject().put("element",element).put("index",index++).put("char",symbol.getText());
                    if(b!=null){row.put("rawBox",new org.json.JSONArray(new int[]{b.left,b.top,b.right,b.bottom}));
                        double[] a=VisualStore.map(b.left,b.top,crop.getWidth(),crop.getHeight(),input.getWidth(),input.getHeight()),z=VisualStore.map(b.right,b.bottom,crop.getWidth(),crop.getHeight(),input.getWidth(),input.getHeight());
                        row.put("cropBox",new org.json.JSONArray(new double[]{a[0],a[1],z[0],z[1]}));pen.setColor(0xffff0000);canvas.drawRect(b,pen);
                    }else row.put("boxStatus","MISSING");
                    int[][] pp=points==null?null:new int[points.length][];org.json.JSONArray rawPoints=new org.json.JSONArray();
                    if(points!=null)for(int k=0;k<points.length;k++){if(points[k]!=null){pp[k]=new int[]{points[k].x,points[k].y};rawPoints.put(new org.json.JSONArray(pp[k]));}else rawPoints.put(org.json.JSONObject.NULL);}
                    String state=VisualStore.corners(pp,input.getWidth(),input.getHeight());row.put("cornerStatus",state).put("rawCorners",rawPoints);
                    if("OK".equals(state)){pen.setColor(0xff0000ff);for(int k=0;k<4;k++)canvas.drawLine(pp[k][0],pp[k][1],pp[(k+1)%4][0],pp[(k+1)%4][1],pen);}
                    symbols.put(row);
                }element++;
            }
            java.io.ByteArrayOutputStream original=new java.io.ByteArrayOutputStream(),marked=new java.io.ByteArrayOutputStream();
            if(SystemClock.elapsedRealtime()-started>VisualStore.TIME_MS){outcome="TIME_LIMIT";return;}
            if(!input.compress(Bitmap.CompressFormat.PNG,100,original)||!overlay.compress(Bitmap.CompressFormat.PNG,100,marked)){outcome="ENCODE_FAILED";return;}
            double sx=(double)crop.getWidth()/(input.getWidth()-48),sy=(double)crop.getHeight()/(input.getHeight()-48);
            org.json.JSONObject meta=new org.json.JSONObject().put("version",1).put("ocrStatus",text==null?"OCR_FAILED":"OCR_RETURNED").put("photo",photo).put("diagnosticRequest",visualRequestScope).put("bridgeRequestAvailable",false)
                .put("taskGeneration",generation).put("cropId",contractSymbolScope).put("passId","contract-"+pass).put("inputWidth",input.getWidth()).put("inputHeight",input.getHeight())
                .put("cropWidth",crop.getWidth()).put("cropHeight",crop.getHeight()).put("scale",pass==1?1.5:2).put("contrastGain",pass==0?1:pass==1?1.35:1.8)
                .put("contrastOffset",pass==0?0:128*(1-(pass==1?1.35:1.8))+12).put("grayscale",pass>0).put("padding",24)
                .put("inverse",new org.json.JSONArray(new double[]{sx,sy,-24*sx,-24*sy})).put("symbols",symbols).put("collectionDiagnostics",contractSymbolDiagnostics);
            if(generation!=contractSymbolGeneration||!photo.equals(visualPhoto)){outcome="STALE";return;}
            outcome=VisualStore.write(new java.io.File(getFilesDir(),"ocr-visual-diagnostic"),photo,visualRequestScope,generation,pass,original.toByteArray(),marked.toByteArray(),meta.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8),started,SystemClock::elapsedRealtime);
        }catch(Exception|OutOfMemoryError ignored){outcome="DIAGNOSTIC_FAILED";}
        finally{if(overlay!=null)overlay.recycle();try{visualReports.put(new org.json.JSONObject().put("pass",pass).put("status",outcome).put("elapsedMs",SystemClock.elapsedRealtime()-started));}catch(Exception|OutOfMemoryError ignored){}}
    }

    final org.json.JSONArray diagnosticPasses=new org.json.JSONArray();
    boolean diagnosticDecoded=false,diagnosticOcrStarted=false;
    String diagnosticError="",diagnosticTrace="";
    static final String BOUNDARY_FIXTURE_HASH="5bb260c091fa235417e10ad9c90b2e735dcc41574008d18ddf2603d2e60459a6";
    final org.json.JSONArray boundaryEvents=new org.json.JSONArray();
    boolean boundaryFixture;
    void boundaryEvent(String event){if(boundaryFixture)boundaryEvents.put(event);}
    boolean isBoundaryFixture(Uri uri){
        try(java.io.InputStream in=getContentResolver().openInputStream(uri)){
            if(in==null)return false;
            java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
            byte[] buffer=new byte[8192];int count;
            while((count=in.read(buffer))!=-1)digest.update(buffer,0,count);
            StringBuilder hex=new StringBuilder();
            for(byte value:digest.digest())hex.append(String.format(Locale.ROOT,"%02x",value&255));
            return BOUNDARY_FIXTURE_HASH.contentEquals(hex);
        }catch(Exception ignored){return false;}
    }
    void boundaryReading(String stage,Text text){
        if(!boundaryFixture)return;
        String raw=text.getText().toUpperCase(Locale.ROOT);
        boundaryEvent(stage+" expectedS="+raw.contains("R3126SX900001")+" observed5="+raw.contains("R31265X900001"));
    }
    void saveBoundaryInput(Bitmap crop){
        if(!boundaryFixture)return;
        try{
            java.io.File dir=new java.io.File(getFilesDir(),"boundary-diagnostic");
            if(!dir.isDirectory()&&!dir.mkdirs()){boundaryEvent("input image directory unavailable");return;}
            java.io.File file=java.io.File.createTempFile("boundary-input-",".png",dir);
            try(java.io.FileOutputStream out=new java.io.FileOutputStream(file)){
                if(crop.compress(Bitmap.CompressFormat.PNG,100,out)){
                    boundaryEvent("input "+file.getName()+" size="+crop.getWidth()+"x"+crop.getHeight());
                }else boundaryEvent("input image encoding failed");
            }
        }catch(Exception ignored){boundaryEvent("input image save failed");}
    }
    void diagnosticReading(String stage,Text text){
        boundaryReading(stage,text);
        try{org.json.JSONObject pass=new org.json.JSONObject();pass.put("stage",stage);pass.put("raw",text.getText());
            org.json.JSONArray candidates=new org.json.JSONArray();
            for(Fields.Box b:boxes(text)){
                String v=b.text().replaceAll("\\s+","").toUpperCase(Locale.ROOT);
                if(v.matches(".*[A-Z0-9]{6,}.*")){org.json.JSONObject c=new org.json.JSONObject();c.put("text",b.text());c.put("left",b.left());c.put("top",b.top());c.put("right",b.right());c.put("bottom",b.bottom());candidates.put(c);}
            }
            pass.put("candidates",candidates);diagnosticPasses.put(pass);
        }catch(Exception ignored){}
    }
    org.json.JSONObject diagnosticResult(Fields.Result r){
        org.json.JSONObject d=new org.json.JSONObject();try{
            d.put("visualDiagnostics",visualReports);if(VisualStore.allowed(visualPhoto))d.put("regionEvents",regionEvents);
            d.put("imageDecoded",diagnosticDecoded);d.put("ocrStarted",diagnosticOcrStarted);
            d.put("passes",diagnosticPasses);d.put("trace",diagnosticTrace);d.put("error",diagnosticError);
            d.put("guideFirst",guideTried);d.put("originalFallback",guideFallback);if(boundaryFixture)d.put("boundaryEvents",boundaryEvents);
            org.json.JSONArray reasons=new org.json.JSONArray();
            if(!diagnosticError.isEmpty())reasons.put(diagnosticError);
            if(r.contract().isEmpty())reasons.put("계약번호 추출 또는 기존 교차검증을 통과하지 못했습니다.");
            if(r.vin().isEmpty())reasons.put("차대번호 추출 또는 17자리 검증을 통과하지 못했습니다.");
            for(String line:diagnosticTrace.split("\\n"))if(line.startsWith("[")&&(line.contains("실패")||line.contains("불가")||line.contains("오류")))reasons.put(line);
            d.put("reasons",reasons);
        }catch(Exception ignored){}return d;
    }
    final ArrayList<Uri> photos=new ArrayList<>();
    final ExecutorService worker=Executors.newSingleThreadExecutor();
    TextRecognizer latin,korean; LinearLayout root,results;TextView status;Button camera,pick,run,share;
    final Map<Integer,double[]> trialTimings=new HashMap<>();
    String reviewContractCrop="", reviewVinCrop="", reviewNameCrop="";
    final Set<String> wholeContractEvidence=new LinkedHashSet<>();
    final Set<String> reviewContractCandidates=new LinkedHashSet<>();
    final Set<String> partialContractCandidates=new LinkedHashSet<>();
    final Set<String> partialVinCandidates=new LinkedHashSet<>();
    final Map<Integer,List<byte[]>> diagnosticImages=new HashMap<>();
    final Map<Integer,List<String>> diagnosticLabels=new HashMap<>();
    void captureDiagnostic(int index,String label,Bitmap bitmap){
        java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,out);
        diagnosticImages.computeIfAbsent(index,k->new ArrayList<>()).add(out.toByteArray());
        diagnosticLabels.computeIfAbsent(index,k->new ArrayList<>()).add(label);
    }
    void showDiagnostic(int index){
        ScrollView scroll=new ScrollView(this);LinearLayout panel=new LinearLayout(this);panel.setOrientation(1);panel.setPadding(24,24,24,24);scroll.addView(panel);
        text(panel,"22번 · 사진 "+(index+1)+" · 실제 재인식 이미지",20);
        text(panel,"QX 전체와 아래 꼬리가 보이는지 확인해주세요. 화면을 캡처해 보내주시면 됩니다.",15);
        List<byte[]> images=diagnosticImages.get(index);List<String> labels=diagnosticLabels.get(index);
        if(images!=null)for(int n=0;n<images.size();n++){
            text(panel,labels.get(n),15);byte[] bytes=images.get(n);
            Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length);
            ImageView image=new ImageView(this);image.setAdjustViewBounds(true);image.setScaleType(ImageView.ScaleType.FIT_CENTER);image.setImageBitmap(bitmap);panel.addView(image,new LinearLayout.LayoutParams(-1,-2));
        }
        new AlertDialog.Builder(this).setTitle("잘라낸 영역 확인 · 22번").setView(scroll).setPositiveButton("닫기",null).show();
    }
    Uri capture;boolean busy=false;long batchStart;int numberOk=0;StringBuilder report=new StringBuilder();
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        latin=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        korean=TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
        ScrollView scroll=new ScrollView(this);root=new LinearLayout(this);root.setOrientation(1);root.setPadding(32,48,32,32);scroll.addView(root);setContentView(scroll);SafeInsets.apply(scroll,0);
        text(root,"썬쿠 OCR 시험용 22 · 영역 확인",24);text(root,"사진은 이 휴대폰에서만 인식합니다. 사이트 등록 기능은 없습니다.",14);
        text(root,"촬영 안내: 서류 한 장을 똑바로 펴고 전체 테두리가 보이게 찍어주세요. 그림자·빛 반사를 피하고 글자에 초점을 맞춰주세요.",14);
        camera=button("연속 촬영하기",v->openBurstCamera());pick=button("내부 시험 사진은 시작 화면에서 선택",v->{});
        status=text(root,"사진을 선택해주세요.",16);run=button("선택한 사진 인식",v->start());
        share=button("오프라인 시험: 외부 공유 차단",v->{});share.setEnabled(false);
        results=new LinearLayout(this);results.setOrientation(1);root.addView(results);
        text(root,"형식 통과는 원본과 정확히 일치한다는 뜻이 아닙니다. 결과와 원본을 대조해주세요.",13);
        if(state!=null){for(String u:state.getStringArrayList("photos")==null?new ArrayList<String>():state.getStringArrayList("photos"))photos.add(Uri.parse(u));String c=state.getString("capture");if(c!=null)capture=Uri.parse(c);}
        if(capture==null){String pending=getPreferences(0).getString("pendingCapture",null);if(pending!=null)capture=Uri.parse(pending);}
        selected();
        if(getIntent().getBooleanExtra("nativeRequest",false)){photos.clear();photos.add(getIntent().getData());root.removeAllViews();root.addView(status);status.setText("휴대폰에서 번호를 읽고 있습니다…");start();}
    }
    TextView text(LinearLayout parent,String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setPadding(0,12,0,12);t.setTextIsSelectable(false);parent.addView(t);return t;}
    Button button(String title,View.OnClickListener click){Button b=new Button(this);b.setText(title);root.addView(b);b.setOnClickListener(click);return b;}
    void selected(){status.setText("사진 "+photos.size()+"장 선택됨");run.setEnabled(!photos.isEmpty()&&!busy);}
    void openBurstCamera(){
        if(checkSelfPermission(android.Manifest.permission.CAMERA)!=android.content.pm.PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{android.Manifest.permission.CAMERA},90);return;}
        startActivityForResult(new Intent(this,BurstCameraActivity.class),11);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
        super.onRequestPermissionsResult(request,permissions,results);
        if(request==90){if(results.length>0&&results[0]==android.content.pm.PackageManager.PERMISSION_GRANTED)openBurstCamera();else status.setText("촬영하려면 카메라 권한을 허용해주세요. 사진 가져오기도 사용할 수 있습니다.");}
    }
    void camera(){
        status.setText("외부 카메라 호출 차단: 연속 촬영을 사용하세요.");
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==11){
            if(result==RESULT_OK&&data!=null&&data.getClipData()!=null){for(int n=0;n<data.getClipData().getItemCount();n++)add(data.getClipData().getItemAt(n).getUri());selected();if(!photos.isEmpty())start();}
            else selected();return;
        }
        if(request==10){
            if(capture==null){String saved=getPreferences(0).getString("pendingCapture",null);if(saved!=null)capture=Uri.parse(saved);}
            Uri destination=capture;
            if(destination==null&&data!=null)destination=data.getData();
            if(destination==null){selected();status.setText("카메라 반환 코드 "+result+" · 사진 주소 없음");return;}
            acceptCapture(destination,0,result==RESULT_OK);return;
        }
        if(request==20 && result==RESULT_OK && data!=null){
            if(data.getClipData()!=null)for(int n=0;n<data.getClipData().getItemCount();n++)add(data.getClipData().getItemAt(n).getUri());else if(data.getData()!=null)add(data.getData());
        }selected();
    }
    void acceptCapture(Uri uri,int attempt,boolean confirmed){
        status.setText("외부 촬영 결과 가져오기 차단");
    }
    void previewCancelledCapture(Uri uri){
        status.setText("외부 촬영 결과 가져오기 차단");
    }
    void add(Uri uri){try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignored){}if(!photos.contains(uri))photos.add(uri);}
    @Override public void onSaveInstanceState(Bundle s){super.onSaveInstanceState(s);ArrayList<String> u=new ArrayList<>();for(Uri p:photos)u.add(p.toString());s.putStringArrayList("photos",u);if(capture!=null)s.putString("capture",capture.toString());}
    void start(){if(busy||photos.isEmpty())return;busy=true;camera.setEnabled(false);pick.setEnabled(false);run.setEnabled(false);share.setEnabled(false);results.removeAllViews();report.setLength(0);report.append("썬쿠 OCR 시험용 22 (0.22-test)\n\n");diagnosticImages.clear();diagnosticLabels.clear();trialTimings.clear();numberOk=0;batchStart=SystemClock.elapsedRealtime();process(0);}
    List<Fields.Box> boxes(Text value){List<Fields.Box> b=new ArrayList<>();for(Text.TextBlock block:value.getTextBlocks())for(Text.Line line:block.getLines()){
        String label=line.getText().replaceAll("\\s+","");
        if(label.equals("계약번호")||label.equals("계약자명")||label.equals("차대번호")){
            Rect r=line.getBoundingBox();if(r!=null)b.add(new Fields.Box(line.getText(),r.left,r.top,r.right,r.bottom));
        }else for(Text.Element e:line.getElements()){
            Rect q=e.getBoundingBox();if(q==null)continue;
            b.add(new Fields.Box(e.getText(),q.left,q.top,q.right,q.bottom));
            String token=e.getText().replaceAll("\\s+","").toUpperCase(Locale.ROOT);int start=Fields.vinFragmentStart(token);
            if(start>0){List<Text.Symbol> symbols=e.getSymbols();StringBuilder joined=new StringBuilder();for(Text.Symbol symbol:symbols)joined.append(symbol.getText().toUpperCase(Locale.ROOT));
                if(symbols.size()==token.length()&&joined.toString().equals(token)){
                    Rect bounds=null;boolean valid=true;for(int n=start;n<symbols.size();n++){Rect r=symbols.get(n).getBoundingBox();if(r==null){valid=false;break;}if(bounds==null)bounds=new Rect(r);else bounds.union(r);}
                    if(valid&&bounds!=null)b.add(new Fields.Box(token.substring(start),bounds.left,bounds.top,bounds.right,bounds.bottom));
                }
            }
        }
    }return b;}
    boolean guideTried=false,guideFallback=false;
    Bitmap guideOriginal;long guideStarted;
    void process(int index){
        if(index>=photos.size()){busy=false;camera.setEnabled(true);pick.setEnabled(true);run.setEnabled(true);share.setEnabled(true);double total=(SystemClock.elapsedRealtime()-batchStart)/1000.;String s=String.format(Locale.KOREA,"%d장 처리 / 번호 형식 통과 %d장\n전체 %.3f초 / 평균 %.3f초",photos.size(),numberOk,total,total/photos.size());status.setText(s);report.append(s);return;}
        status.setText((index+1)+" / "+photos.size()+"장 인식 중");long begin=SystemClock.elapsedRealtime();
        worker.execute(()->{
            try{Bitmap bitmap=ImageDecoder.decodeBitmap(ImageDecoder.createSource(getContentResolver(),photos.get(index)),(decoder,info,source)->decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE));
                diagnosticDecoded=true;long loaded=SystemClock.elapsedRealtime();
                boundaryFixture=getIntent().getBooleanExtra("nativeRequest",false)&&isBoundaryFixture(photos.get(index));
                beginVisualDiagnostic(photos.get(index));
                boundaryEvent("decoded "+bitmap.getWidth()+"x"+bitmap.getHeight());
                float[] rect=getIntent().getFloatArrayExtra("guideRect");
                if(getIntent().getBooleanExtra("nativeRequest",false)&&!getIntent().getBooleanExtra("nameOnly",false)&&rect!=null&&rect.length==4){
                    int x=Math.max(0,(int)(bitmap.getWidth()*rect[0])),y=Math.max(0,(int)(bitmap.getHeight()*rect[1]));
                    int right=Math.min(bitmap.getWidth(),(int)Math.ceil(bitmap.getWidth()*rect[2]));
                    int bottom=Math.min(bitmap.getHeight(),(int)Math.ceil(bitmap.getHeight()*rect[3]));
                    if(right>x&&bottom>y){guideOriginal=bitmap;guideTried=true;guideStarted=begin;boundaryEvent("guide rect="+x+","+y+","+right+","+bottom);
                        recognize(index,begin,loaded,Bitmap.createBitmap(bitmap,x,y,right-x,bottom-y),false);return;}
                }
                recognize(index,begin,loaded,bitmap,false);
            }catch(Exception e){runOnUiThread(()->failed(index,begin,"사진을 열지 못했습니다. 파일 권한과 형식을 확인해주세요."));}
        });
    }
    int rotation(Text reading){
        int[] votes=new int[4];
        for(Text.TextBlock block:reading.getTextBlocks())for(Text.Line line:block.getLines()){
            android.graphics.Point[] pts=line.getCornerPoints();
            if(pts==null||pts.length<2||line.getText().length()<4)continue;
            double angle=Math.toDegrees(Math.atan2(pts[1].y-pts[0].y,pts[1].x-pts[0].x));
            int turn=((int)Math.round(angle/90)+4)%4;votes[turn]+=line.getText().length();
        }
        int best=0,total=0;for(int n=0;n<4;n++){total+=votes[n];if(votes[n]>votes[best])best=n;}
        return total>0&&votes[best]>total*0.65?best:0;
    }
    String partialTarget(){return getIntent().getStringExtra("partialTarget");}
    void recognize(int index,long begin,long loaded,Bitmap bitmap,boolean rotated){
        diagnosticOcrStarted=true;
        long started=SystemClock.elapsedRealtimeNanos();
        latin.process(InputImage.fromBitmap(bitmap,0)).addOnCompleteListener(t->{
            long elapsed=SystemClock.elapsedRealtimeNanos()-started;
            bitmap.recycle();
            if(!t.isSuccessful()){setResult(RESULT_CANCELED);finish();return;}
            try{
                org.json.JSONObject result=new org.json.JSONObject();
                result.put("lineText",t.getResult().getText());
                result.put("nativeMs",elapsed/1000000.0);
                result.put("diagnostic",new org.json.JSONObject().put("ocrStarted",true));
                Intent data=new Intent();
                data.putExtra("nativeRequestId",getIntent().getStringExtra("nativeRequestId"));
                data.putExtra("result",result.toString());
                setResult(RESULT_OK,data);
            }catch(org.json.JSONException e){setResult(RESULT_CANCELED);}
            finish();
        });
        if(diagnosticOcrStarted)return;
        resetContractSymbols();
        clearReference();
        diagnosticOcrStarted=true;InputImage image=InputImage.fromBitmap(bitmap,0);
        latin.process(image).addOnSuccessListener(t->{
            diagnosticReading(guideOriginal!=null?"가이드 영역 영문 OCR":"원본 영문 OCR",t);
            recordReferenceObservations("initial",1,t);
            int turn=rotation(t);
            if(!rotated&&turn!=0){
                android.graphics.Matrix matrix=new android.graphics.Matrix();matrix.postRotate(-turn*90);
                Bitmap upright=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),matrix,true);boundaryEvent("orientation correction="+turn+" before="+bitmap.getWidth()+"x"+bitmap.getHeight()+" after="+upright.getWidth()+"x"+upright.getHeight());
                if(upright!=bitmap)bitmap.recycle();recognize(index,begin,loaded,upright,true);return;
            }
            if(getIntent().getBooleanExtra("nameOnly",false)){
                korean.process(image).addOnSuccessListener(k->{diagnosticReading("계약자명 한국어 OCR",k);List<Fields.Box> locations=boxes(k);String name=Fields.extract(locations).name();reviewNameCrop=reviewFieldCrop(bitmap,locations,"계약자명");if(reviewNameCrop.isEmpty())reviewNameCrop=reviewValueCrop(bitmap,locations,name);bitmap.recycle();returnNative(new Fields.Result("","",name),SystemClock.elapsedRealtime()-begin);}).addOnFailureListener(error->{bitmap.recycle();returnNative(new Fields.Result("","",""),SystemClock.elapsedRealtime()-begin);});return;
            }
            long latinEnd=SystemClock.elapsedRealtime();Fields.Result first=Fields.extract(boxes(t));
            rememberWholeContract(boxes(t));rememberPartialContract(boxes(t),false);rememberPartialVin(boxes(t),false);
            reviewVinCrop=reviewVinPreview(bitmap,boxes(t),first.vin());
            if("contract".equals(partialTarget())||"vin".equals(partialTarget())){
                // Locate the requested field; never route into the other field's retry.
                korean.process(image).addOnSuccessListener(k->{
                    diagnosticReading("부분 재인식 위치 확인",k);
                    List<Fields.Box> locations=boxes(k);
                    Fields.Result second=Fields.extract(locations);
                    if("contract".equals(partialTarget())){
                        rememberWholeContract(locations);rememberPartialContract(locations,false);
                        Fields.Result seed=new Fields.Result(merge(first.contract(),second.contract()),"","");
                        retryContract(index,begin,loaded,latinEnd,bitmap,locations,seed,k.getText());
                    }else retryVin(index,begin,loaded,latinEnd,bitmap,locations,new Fields.Result("","",""),k.getText(),0);
                }).addOnFailureListener(e->{bitmap.recycle();failed(index,begin,"부분 재인식 위치 확인 실패");});return;
            }
            if(guideOriginal!=null&&(first.contract().isEmpty()||first.vin().isEmpty())){
                bitmap.recycle();returnNative(first,SystemClock.elapsedRealtime()-begin);return;
            }
            String orientation=rotated?"[글자 방향으로 회전 보정]\n":"";
            if(!first.contract().isEmpty()&&!first.vin().isEmpty())retryContract(index,begin,loaded,latinEnd,bitmap,boxes(t),first,orientation+t.getText());
            else korean.process(image).addOnSuccessListener(k->{
                diagnosticReading("번호 보완 한국어 OCR",k);
                Fields.Result second=Fields.extract(boxes(k));
                rememberWholeContract(boxes(k));rememberPartialContract(boxes(k),false);rememberPartialVin(boxes(k),false);
                Fields.Result merged=new Fields.Result(merge(first.contract(),second.contract()),merge(first.vin(),second.vin()),second.name());
                if(reviewVinCrop.isEmpty())reviewVinCrop=reviewVinPreview(bitmap,boxes(k),merged.vin());
                reviewNameCrop=reviewFieldCrop(bitmap,boxes(k),"계약자명");if(reviewNameCrop.isEmpty())reviewNameCrop=reviewValueCrop(bitmap,boxes(k),second.name());
                String raw=orientation+t.getText()+"\n[한국어 재인식]\n"+k.getText();
                if(merged.vin().isEmpty())retryVin(index,begin,loaded,latinEnd,bitmap,boxes(k),merged,raw,0);
                else retryContract(index,begin,loaded,latinEnd,bitmap,boxes(k),merged,raw);
            }).addOnFailureListener(e->{bitmap.recycle();failed(index,begin,"한국어 재인식 실패");});
        }).addOnFailureListener(e->{bitmap.recycle();failed(index,begin,"문자 인식 실패");});
    }
    void retryVin(int index,long begin,long loaded,long latinEnd,Bitmap bitmap,List<Fields.Box> locations,Fields.Result previous,String raw,int attempt){
        Fields.Box area=Fields.vinRegion(locations,attempt);
        if(area==null){retryContract(index,begin,loaded,latinEnd,bitmap,locations,previous,raw+"\n[차대번호 칸 위치 확인 불가]");return;}
        int x=Math.max(0,area.left()),y=Math.max(0,area.top());
        int w=Math.min(bitmap.getWidth(),area.right())-x,h=Math.min(bitmap.getHeight(),area.bottom())-y;
        if(w<=0||h<=0){retryContract(index,begin,loaded,latinEnd,bitmap,locations,previous,raw);return;}
        Bitmap crop=Bitmap.createBitmap(bitmap,x,y,w,h),variant=contractImage(crop,attempt);
        if(crop!=bitmap)crop.recycle();
        latin.process(InputImage.fromBitmap(variant,0)).addOnSuccessListener(t->{
            rememberPartialVin(boxes(t),true);String vin=Fields.extract(boxes(t)).vin();variant.recycle();
            if(!vin.isEmpty()&&getIntent().getBooleanExtra("nativeRequest",false)){
                reviewVinCrop=reviewCrop(bitmap,x,y,w,h);
            }
            String trace=raw+"\n[차대번호 실제 글자 경계+여백 재인식 "+(attempt+1)+" / 범위 "+x+","+y+","+w+","+h+"]\n"+t.getText();
            if(vin.isEmpty()&&attempt<2)retryVin(index,begin,loaded,latinEnd,bitmap,locations,previous,trace,attempt+1);
            else retryContract(index,begin,loaded,latinEnd,bitmap,locations,new Fields.Result(previous.contract(),vin,previous.name()),trace);
        }).addOnFailureListener(e->{variant.recycle();retryContract(index,begin,loaded,latinEnd,bitmap,locations,previous,raw+"\n[차대번호 재인식 실행 실패]");});
    }
    void retryContract(int index,long begin,long loaded,long latinEnd,Bitmap bitmap,List<Fields.Box> boxes,Fields.Result previous,String raw){
        if("vin".equals(partialTarget())){
            bitmap.recycle();finish(index,begin,loaded,latinEnd,SystemClock.elapsedRealtime()-latinEnd,
                new Fields.Result("",previous.vin(),""),raw);return;
        }
        regionEvent("selection source="+bitmap.getWidth()+"x"+bitmap.getHeight()+" guide="+(guideOriginal!=null)+" fallback="+guideFallback);
        Fields.Box area=Fields.contractRegion(boxes,bitmap.getWidth(),bitmap.getHeight(),VisualStore.allowed(visualPhoto)?this::regionEvent:null);
        Fields.Result unchecked=new Fields.Result("",previous.vin(),previous.name());
        if(area==null){bitmap.recycle();finish(index,begin,loaded,latinEnd,SystemClock.elapsedRealtime()-latinEnd,unchecked,raw+"\n[계약번호 칸 교차확인 불가 · 확인 필요]");return;}
        int pad=Math.max(8,area.height()/2);
        int verticalPad=Fields.contractLayout(area.text())!=null&&Fields.contractCandidate(area.text()).isEmpty()?Fields.contractRowRetryMargin(area):pad/2;
        int x=Math.max(0,area.left()-pad),y=Math.max(0,area.top()-verticalPad);
        int right=Math.min(bitmap.getWidth(),area.right()+pad),bottom=Math.min(bitmap.getHeight(),area.bottom()+verticalPad);
        if(right<=x||bottom<=y){bitmap.recycle();finish(index,begin,loaded,latinEnd,SystemClock.elapsedRealtime()-latinEnd,unchecked,raw+"\n[계약번호 칸 범위 오류 · 확인 필요]");return;}
        final int reviewTop=y,reviewBottom=bottom;
        int sourceMargin=Fields.contractSourceMargin(area,boxes,x,y,right,bottom,bitmap.getHeight(),verticalPad);
        if(sourceMargin>verticalPad){
            y=area.top()-sourceMargin;
            bottom=area.bottom()+sourceMargin;
        }
        regionEvent("selected before="+Fields.regionCoordinates(area)+" pad="+pad+" final="+x+","+y+","+right+","+bottom);
        boundaryEvent("contract crop in current image="+x+","+y+","+right+","+bottom+" source="+bitmap.getWidth()+"x"+bitmap.getHeight()+" guided="+(guideOriginal!=null));
        Bitmap crop=Bitmap.createBitmap(bitmap,x,y,right-x,bottom-y);
        if(crop==bitmap)crop=bitmap.copy(Bitmap.Config.ARGB_8888,false);
        if(getIntent().getBooleanExtra("nativeRequest",false)){
            List<Fields.Box> values=boxes.stream().filter(b->Fields.contractLayout(b.text())!=null
                && b.left()>=x && b.right()<=right && b.top()>=reviewTop && b.bottom()<=reviewBottom).toList();
            if(values.size()==1)reviewContractCrop=reviewValueCrop(bitmap,values,values.get(0).text());
            if(reviewContractCrop.isEmpty())reviewContractCrop=reviewFieldCrop(bitmap,boxes,"계약번호");
        }
        bitmap.recycle();
        List<String> readings=new ArrayList<>();if(!previous.contract().isEmpty())readings.add(previous.contract());
        rememberContractCandidates(readings);
        contractVariant(index,begin,loaded,latinEnd,crop,previous,raw,0,readings);
    }
    // Preview only: never supplies or confirms an OCR value.
    String reviewFieldCrop(Bitmap bitmap,List<Fields.Box> locations,String label){
        if(!getIntent().getBooleanExtra("nativeRequest",false))return "";
        List<Fields.Box> headings=locations.stream().filter(b->Fields.compact(b.text()).equals(label)).distinct().toList();
        if(headings.size()!=1)return "";
        Fields.Box heading=headings.get(0),area=Fields.regionBelow(locations,label);
        if(area==null)return "";
        int left=Math.max(0,area.left()),top=Math.max(0,area.top());
        int right=Math.min(bitmap.getWidth(),area.right()),bottom=Math.min(bitmap.getHeight(),area.bottom());
        // Stop before a lower heading; do not borrow the neighbouring field.
        Set<String> titles=Set.of("계약번호","차대번호","계약자명","인수유형","생년월일","출고일","판매코드","임시번호","서비스품목");
        for(Fields.Box b:locations){
            if(b==heading||!titles.contains(Fields.compact(b.text())))continue;
            if(b.top()>=top&&b.right()>left&&b.left()<right)bottom=Math.min(bottom,b.top());
        }
        int columnLeft=0,columnRight=bitmap.getWidth();
        for(Fields.Box b:locations){
            if(b==heading||!titles.contains(Fields.compact(b.text())))continue;
            if(Math.abs((b.top()+b.bottom())-(heading.top()+heading.bottom()))>Math.max(b.height(),heading.height())*2)continue;
            if(b.cx()>heading.cx())columnRight=Math.min(columnRight,(heading.right()+b.left())/2);
            if(b.cx()<heading.cx())columnLeft=Math.max(columnLeft,(b.right()+heading.left())/2);
        }
        // OCR fragments locate the preview only, regardless of number validity.
        // Extend to their ends, bounded by the neighbouring column headings.
        for(int pass=0;pass<3;pass++)for(Fields.Box b:locations){
            if(titles.contains(Fields.compact(b.text()))||b.top()<top-heading.height()/3||b.bottom()>bottom)continue;
            if(b.left()<columnLeft||b.right()>columnRight)continue;
            if(b.left()>right+heading.height()||b.right()<left-heading.height())continue;
            left=Math.max(columnLeft,Math.min(left,b.left()-Math.max(2,b.height()/5)));
            right=Math.min(columnRight,Math.max(right,b.right()+Math.max(2,b.height()/5)));
        }
        if(right<=left||bottom<=top||bottom-top<heading.height()/2)return "";
        return reviewCrop(bitmap,left,top,right-left,bottom-top);
    }
    String reviewVinPreview(Bitmap bitmap,List<Fields.Box> locations,String vin){
        if(!getIntent().getBooleanExtra("nativeRequest",false))return "";
        if(vin.isEmpty())return reviewFieldCrop(bitmap,locations,"차대번호");
        String exact=reviewValueCrop(bitmap,locations,vin);
        if(!exact.isEmpty())return exact;
        Fields.Box area=Fields.vinRegion(locations);
        if(area==null)return "";
        int x=Math.max(0,area.left()),y=Math.max(0,area.top());
        int width=Math.min(bitmap.getWidth(),area.right())-x;
        int height=Math.min(bitmap.getHeight(),area.bottom())-y;
        return width>0&&height>0?reviewCrop(bitmap,x,y,width,height):"";
    }
    String reviewValueCrop(Bitmap bitmap,List<Fields.Box> locations,String value){
        if(value.isEmpty()||!getIntent().getBooleanExtra("nativeRequest",false))return "";
        String target=Fields.compact(value);
        List<Fields.Box> matches=locations.stream().filter(b->Fields.compact(b.text()).equals(target)).distinct().toList();
        if(matches.size()!=1)return "";
        Fields.Box box=matches.get(0);int pad=Math.max(2,box.height()/5);
        int x=Math.max(0,box.left()-pad),y=Math.max(0,box.top()-pad);
        int right=Math.min(bitmap.getWidth(),box.right()+pad),bottom=Math.min(bitmap.getHeight(),box.bottom()+pad);
        if(right<=x||bottom<=y)return "";
        return reviewCrop(bitmap,x,y,right-x,bottom-y);
    }
    String reviewCrop(Bitmap bitmap,int x,int y,int width,int height){
        Bitmap crop=Bitmap.createBitmap(bitmap,x,y,width,height);
        String encoded=encodeReviewCrop(crop);
        if(crop!=bitmap)crop.recycle();
        return encoded;
    }
    String encodeReviewCrop(Bitmap crop){
        double scale=Math.min(1,Math.min(900.0/crop.getWidth(),240.0/crop.getHeight()));
        Bitmap preview=scale==1?crop:Bitmap.createScaledBitmap(crop,Math.max(1,(int)(crop.getWidth()*scale)),Math.max(1,(int)(crop.getHeight()*scale)),true);
        java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
        preview.compress(Bitmap.CompressFormat.JPEG,75,bytes);
        // Keep the original photo intact; reduce only this local preview.
        for(int attempt=0;bytes.size()>24000&&attempt<4;attempt++){
            Bitmap smaller=Bitmap.createScaledBitmap(preview,Math.max(1,preview.getWidth()*3/4),Math.max(1,preview.getHeight()*3/4),true);
            if(preview!=crop&&preview!=smaller)preview.recycle();
            preview=smaller;bytes.reset();preview.compress(Bitmap.CompressFormat.JPEG,65,bytes);
        }
        if(preview!=crop)preview.recycle();
        return bytes.size()<=24000?android.util.Base64.encodeToString(bytes.toByteArray(),android.util.Base64.NO_WRAP):"";
    }
    void rememberWholeContract(List<Fields.Box> boxes){
        Set<String> values=new LinkedHashSet<>();
        for(Fields.Box box:boxes){String value=Fields.observedContract(box.text());if(!value.isEmpty())values.add(value);}
        if(values.size()==1)wholeContractEvidence.add(values.iterator().next());
        rememberContractCandidates(values);
    }
    // Display-only evidence. Never used by Fields or automatic certification.
    void rememberPartialVin(List<Fields.Box> boxes,boolean isolated){
        Fields.Box area=null;
        if(!isolated){
            long labels=boxes.stream().filter(b->Fields.compact(b.text()).equals("차대번호")).distinct().count();
            if(labels!=1)return;
            area=Fields.regionBelow(boxes,"차대번호");if(area==null)return;
            Fields.Box heading=boxes.stream().filter(b->Fields.compact(b.text()).equals("차대번호")).findFirst().get();
            int left=area.left(),right=area.right(),bottom=area.bottom(),columnLeft=Integer.MIN_VALUE,columnRight=Integer.MAX_VALUE;
            Set<String> titles=Set.of("계약번호","차대번호","계약자명","인수유형","생년월일","출고일","판매코드","임시번호","서비스품목");
            for(Fields.Box b:boxes){
                if(b==heading||!titles.contains(Fields.compact(b.text())))continue;
                if(b.top()>=area.top()&&b.right()>left&&b.left()<right)bottom=Math.min(bottom,b.top());
                if(Math.abs((b.top()+b.bottom())-(heading.top()+heading.bottom()))>Math.max(b.height(),heading.height())*2)continue;
                if(b.cx()>heading.cx())columnRight=Math.min(columnRight,(heading.right()+b.left())/2);
                if(b.cx()<heading.cx())columnLeft=Math.max(columnLeft,(b.right()+heading.left())/2);
            }
            // Match the preview's bounded fragment expansion, without guessing characters.
            for(int pass=0;pass<3;pass++)for(Fields.Box b:boxes){
                if(!Fields.compact(b.text()).matches("[A-Z0-9?]{1,19}")||b.top()<area.top()-heading.height()/3||b.bottom()>bottom)continue;
                if(b.left()<columnLeft||b.right()>columnRight||b.left()>right+heading.height()||b.right()<left-heading.height())continue;
                left=Math.max(columnLeft,Math.min(left,b.left()));right=Math.min(columnRight,Math.max(right,b.right()));
            }
            area=new Fields.Box("차대번호",left,area.top(),right,bottom);
        }
        List<Fields.Box> fragments=new ArrayList<>();
        for(Fields.Box b:boxes){
            if(!isolated&&(b.top()<area.top()-b.height()/2||b.bottom()>area.bottom()||b.cx()<area.left()||b.cx()>area.right()))continue;
            String value=Fields.compact(b.text());
            if(value.matches("[A-Z0-9?]{1,19}"))fragments.add(b);
            if(!value.matches("[A-Z0-9?]{12,19}")||!value.matches(".*[A-Z].*")||!value.matches(".*[0-9].*"))continue;
            if(partialVinCandidates.size()<12)partialVinCandidates.add(value);
        }
        // Join only observed fragments on one row within the same bounded VIN field.
        fragments.sort(Comparator.comparingInt(Fields.Box::left));
        for(Fields.Box anchor:fragments){
            StringBuilder joined=new StringBuilder();int right=-1;
            for(Fields.Box part:fragments){
                if(part.top()>=anchor.bottom()||part.bottom()<=anchor.top())continue;
                if(right>=0&&(part.left()<right||part.left()-right>Math.max(anchor.height(),part.height())*3))break;
                joined.append(Fields.compact(part.text()));right=part.right();
            }
            String value=joined.toString();
            if(value.matches("[A-Z0-9?]{12,19}")&&value.matches(".*[A-Z].*")&&value.matches(".*[0-9].*")&&partialVinCandidates.size()<12)partialVinCandidates.add(value);
        }
    }
    void rememberPartialContract(List<Fields.Box> boxes,boolean isolated){
        Fields.Box area=null;
        if(!isolated){
            long labels=boxes.stream().filter(b->Fields.compact(b.text()).equals("계약번호")).distinct().count();
            if(labels!=1)return;
            area=Fields.regionBelow(boxes,"계약번호");if(area==null)return;
        }
        for(Fields.Box b:boxes){
            if(!isolated&&(b.top()<area.top()-b.height()/2||b.bottom()>area.bottom()||b.cx()<area.left()||b.cx()>area.right()))continue;
            String value=Fields.compact(b.text());
            if(!value.matches("[A-Z0-9?]{6,16}")||!value.matches(".*[A-Z].*")||!value.matches(".*[0-9].*"))continue;
            if(partialContractCandidates.size()<12)partialContractCandidates.add(value);
        }
    }
    List<String> displayedContractCandidates(){
        Set<String> values=new LinkedHashSet<>(reviewContractCandidates);
        values.addAll(partialContractCandidates);
        return values.stream().limit(3).toList();
    }
    void rememberContractCandidates(Collection<String> readings){
        for(String value:readings){String candidate=Fields.compact(value);if(Fields.contractLayout(candidate)!=null&&reviewContractCandidates.size()<6)reviewContractCandidates.add(candidate);}
    }
    Bitmap contractImage(Bitmap crop,int attempt){
        float scale=attempt==1?1.5f:2f;int border=24;
        int width=Math.max(1,Math.round(crop.getWidth()*scale)),height=Math.max(1,Math.round(crop.getHeight()*scale));
        Bitmap output=Bitmap.createBitmap(width+border*2,height+border*2,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(output);canvas.drawColor(0xffffffff);Paint paint=new Paint(Paint.FILTER_BITMAP_FLAG);
        if(attempt>0){
            ColorMatrix gray=new ColorMatrix();gray.setSaturation(0);
            float gain=attempt==1?1.35f:1.8f;float offset=128*(1-gain)+12;
            ColorMatrix contrast=new ColorMatrix(new float[]{gain,0,0,0,offset,0,gain,0,0,offset,0,0,gain,0,offset,0,0,0,1,0});
            gray.postConcat(contrast);paint.setColorFilter(new ColorMatrixColorFilter(gray));
        }
        canvas.drawBitmap(crop,null,new Rect(border,border,border+width,border+height),paint);return output;
    }
    void contractVariant(int index,long begin,long loaded,long latinEnd,Bitmap crop,Fields.Result previous,String raw,int attempt,List<String> readings){contractVariant(index,begin,loaded,latinEnd,crop,previous,raw,attempt,readings,false);}
    Bitmap levelContract(Bitmap crop,Text reading){
        Text.Line chosen=null;
        for(Text.TextBlock block:reading.getTextBlocks())for(Text.Line line:block.getLines()){
            boolean candidate=false;for(Text.Element e:line.getElements())if(Fields.contractLayout(e.getText())!=null)candidate=true;
            if(candidate){if(chosen!=null)return null;chosen=line;}
        }
        if(chosen==null)return null;android.graphics.Point[] points=chosen.getCornerPoints();
        if(points==null||points.length<2)return null;
        double angle=LevelGeometry.angle(points[1].x-points[0].x,points[1].y-points[0].y);
        if(!LevelGeometry.usable(angle))return null;
        android.graphics.Matrix matrix=new android.graphics.Matrix();matrix.postRotate((float)-angle);
        Bitmap rotated=Bitmap.createBitmap(crop,0,0,crop.getWidth(),crop.getHeight(),matrix,true);
        Bitmap white=Bitmap.createBitmap(rotated.getWidth(),rotated.getHeight(),Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(white);canvas.drawColor(0xffffffff);canvas.drawBitmap(rotated,0,0,new Paint(Paint.FILTER_BITMAP_FLAG));
        if(rotated!=crop)rotated.recycle();boundaryEvent("level angle="+angle+" before="+crop.getWidth()+"x"+crop.getHeight()+" after="+white.getWidth()+"x"+white.getHeight());return white;
    }
    void contractVariant(int index,long begin,long loaded,long latinEnd,Bitmap crop,Fields.Result previous,String raw,int attempt,List<String> readings,boolean leveled){
        // Retry only this original field; normalization is limited to the confirmed six-digit suffix.
        long prepStart=SystemClock.elapsedRealtime();Bitmap variant=contractImage(crop,attempt);
        long prepMillis=SystemClock.elapsedRealtime()-prepStart,ocrStart=SystemClock.elapsedRealtime();
        final int symbolGeneration=contractSymbolGeneration;
        final String diagnosticPhoto=visualPhoto;
        latin.process(InputImage.fromBitmap(variant,0)).addOnSuccessListener(t->{
            if(symbolGeneration!=contractSymbolGeneration){variant.recycle();return;}
            long ocrMillis=SystemClock.elapsedRealtime()-ocrStart;
            double[] timings=trialTimings.computeIfAbsent(index,k->new double[4]);
            timings[leveled?2:0]+=prepMillis;timings[leveled?3:1]+=ocrMillis;
            Fields.Result retry=Fields.extract(boxes(t));
            String trace=raw+String.format(Locale.KOREA,"\n[%s · 보정 %.3f초 · OCR %.3f초]",leveled?"수평 보정":"기존 방식",prepMillis/1000.,ocrMillis/1000.)+"\n[계약번호 칸 재인식 "+(attempt+1)+": "+(attempt==0?"2배 확대":attempt==1?"명암 보정 1.5배":"명암 보정 2배")+"]\n"+t.getText();
            collectContractSymbols(t,crop,variant,attempt,leveled,symbolGeneration);
            visualDiagnostic(t,variant,crop,attempt,leveled,symbolGeneration,diagnosticPhoto);
            variant.recycle();
            boundaryReading("contract whole field leveled="+leveled+" pass="+(attempt+1),t);rememberPartialContract(boxes(t),true);
            Set<String> observed=new LinkedHashSet<>();for(Fields.Box observation:boxes(t))if(Fields.contractLayout(observation.text())!=null)observed.add(observation.text());readings.addAll(observed);rememberContractCandidates(observed);
            recordReferenceObservations(leveled?"whole-leveled":"whole",attempt+1,t);
            String agreed=Fields.agreedContract(readings);
            wholeContractEvidence.addAll(observed.stream().map(Fields::observedContract).filter(s->!s.isEmpty()).toList());
            if(wholeContractEvidence.size()>1)agreed="";
            if(agreed.isEmpty()&&!leveled&&getIntent().getBooleanExtra("nativeRequest",false)){
                try{stageReference(t,crop,attempt);}catch(RuntimeException ignored){releaseReference();}
            }
            if(!agreed.isEmpty()){
                crop.recycle();finish(index,begin,loaded,latinEnd,SystemClock.elapsedRealtime()-latinEnd,new Fields.Result(agreed,previous.vin(),previous.name()),trace+"\n[계약번호 반복 판독 일치 · 원본 대조 필요]",true);
            }else if(attempt<2)contractVariant(index,begin,loaded,latinEnd,crop,previous,trace,attempt+1,readings,leveled);
            else if(!leveled){
                long rotateStart=SystemClock.elapsedRealtime();Bitmap horizontal=levelContract(crop,t);
                double[] timing=trialTimings.computeIfAbsent(index,k->new double[4]);timing[2]+=SystemClock.elapsedRealtime()-rotateStart;
                if(horizontal!=null){captureDiagnostic(index,"수평 보정 전 계약번호 칸",crop);captureDiagnostic(index,"수평 보정 후 계약번호 칸",horizontal);crop.recycle();
                    contractVariant(index,begin,loaded,latinEnd,horizontal,previous,trace+"\n[실패한 계약번호 칸만 수평 보정 비교]",0,readings,true);
                }else splitContract(index,begin,loaded,latinEnd,crop,previous,trace+"\n[수평 보정 미실행: 기울기나 줄 위치 확인 불가 또는 보정 불필요]",t,attempt,readings);
            }else splitContract(index,begin,loaded,latinEnd,crop,previous,trace,t,attempt,readings);
        }).addOnFailureListener(e->{visualDiagnostic(null,variant,crop,attempt,leveled,symbolGeneration,diagnosticPhoto);variant.recycle();crop.recycle();finish(index,begin,loaded,latinEnd,SystemClock.elapsedRealtime()-latinEnd,new Fields.Result("",previous.vin(),previous.name()),raw+"\n[계약번호 칸 교차확인 실행 실패]");});
    }
    Bitmap referenceGlyph;
    String referenceSeed="";
    int referenceOffset;
    boolean referenceUsed;
    final Set<String> referenceCandidates=new LinkedHashSet<>();
    org.json.JSONArray referenceEvents=new org.json.JSONArray();

    void releaseReference(){
        if(referenceGlyph!=null){referenceGlyph.recycle();referenceGlyph=null;}
    }
    void clearReference(){
        releaseReference();referenceCandidates.clear();referenceEvents=new org.json.JSONArray();referenceUsed=false;
    }
    void recordReferenceObservations(String stage,int pass,Text reading){
        for(Fields.Box box:boxes(reading)){
            if(referenceEvents.length()>=80)return;
            if(Fields.contractLayout(box.text())!=null)
                referenceEvents.put(stage+" pass="+pass+" box="+Fields.regionCoordinates(box)+" length="+Fields.compact(box.text()).length());
        }
    }
    void stageReference(Text result,Bitmap crop,int attempt){
        Text.Element seed=null;
        List<Text.Element> elements=new ArrayList<>();
        for(Text.TextBlock block:result.getTextBlocks())for(Text.Line line:block.getLines())elements.addAll(line.getElements());
        for(Text.Element e:elements){
            String word=Fields.compact(e.getText());
            if(word.isEmpty()||!word.equals(Fields.contractCandidate(word)))continue;
            if(seed!=null)return;
            seed=e;
        }
        if(seed==null)return;
        String raw=Fields.compact(seed.getText());
        List<Text.Symbol> symbols=seed.getSymbols();
        if(symbols.size()!=raw.length()||boundaryRow(symbols,crop,attempt)==null)return;
        for(int i=0;i<symbols.size();i++)if(!symbols.get(i).getText().equals(String.valueOf(raw.charAt(i))))return;
        Set<Integer> positions=new LinkedHashSet<>();
        for(String other:wholeContractEvidence)if(other.length()==raw.length())
            for(int i:ContractReference.differences(raw,other))positions.add(i-1);
        referenceEvents.put("whole pass="+(attempt+1)+" length="+raw.length()+" differences="+positions.stream().map(i->i+1).toList());
        if(positions.isEmpty()){positions.add(6);positions.add(5);}
        float scale=attempt==1?1.5f:2f;
        float sx=Math.round(crop.getWidth()*scale)/(float)crop.getWidth();
        float sy=Math.round(crop.getHeight()*scale)/(float)crop.getHeight();
        for(int i:positions){
            if(!ContractReference.supported(raw.charAt(i)))continue;
            Rect rect=glyphRange(symbols,i,i+1,crop,scale);
            if(rect==null||rect.left<=0||rect.top<=0||rect.right>=crop.getWidth()||rect.bottom>=crop.getHeight())continue;
            Rect mapped=new Rect((int)Math.floor(rect.left*sx)+24,(int)Math.floor(rect.top*sy)+24,
                (int)Math.ceil(rect.right*sx)+24,(int)Math.ceil(rect.bottom*sy)+24);
            if(!mapped.contains(symbols.get(i).getBoundingBox()))continue;
            boolean overlaps=false;
            for(Text.Element e:elements)if(e!=seed&&(e.getBoundingBox()==null||Rect.intersects(mapped,e.getBoundingBox())))overlaps=true;
            for(int k=0;k<symbols.size();k++)if(k!=i&&Rect.intersects(mapped,symbols.get(k).getBoundingBox()))overlaps=true;
            if(overlaps)continue;
            releaseReference();
            referenceGlyph=Bitmap.createBitmap(crop,rect.left,rect.top,rect.width(),rect.height());
            referenceSeed=raw;referenceOffset=i;
            referenceEvents.put("whole pass="+(attempt+1)+" field-local="+rect+" length="+raw.length()+" position="+(i+1));
            return;
        }
    }
    void readReference(Fields.Result result,long millis,boolean verified,int attempt){
        if(isFinishing()||isDestroyed()||referenceGlyph==null)return;
        Bitmap input=contractImage(referenceGlyph,attempt==0?0:2);
        latin.process(InputImage.fromBitmap(input,0)).addOnCompleteListener(task->{
            input.recycle();
            if(isFinishing()||isDestroyed()||referenceGlyph==null)return;
            if(task.isSuccessful()){
                String candidate=ContractReference.candidate(referenceSeed,referenceOffset,task.getResult().getText());
                if(!candidate.isEmpty())referenceCandidates.add(candidate);
            }
            referenceEvents.put("reference pass="+(attempt+1)+" candidateCount="+referenceCandidates.size());
            if(attempt+1<ContractReference.MAX_PASSES)readReference(result,millis,verified,attempt+1);
            else {releaseReference();returnNative(result,millis,verified);}
        });
    }
    Rect glyphRange(List<Text.Symbol> symbols,int from,int to,Bitmap crop,float scale){
        Rect union=null;
        for(int i=from;i<to;i++){
            Rect box=symbols.get(i).getBoundingBox();if(box==null)return null;
            if(union==null)union=new Rect(box);else union.union(box);
        }
        if(union==null)return null;
        // Map actual glyph bounds in the enlarged field back to the unchanged field pixels.
        // Keep descenders (for example Q tails) and whitespace; stop between neighboring glyphs.
        int padX=Math.max(2,Math.round(union.height()*0.25f)),padY=Math.max(3,Math.round(union.height()*0.35f));
        int l=union.left-padX,r=union.right+padX;
        if(from>0){Rect prev=symbols.get(from-1).getBoundingBox();if(prev!=null)l=Math.max(l,(prev.right+union.left)/2);}
        if(to<symbols.size()){Rect next=symbols.get(to).getBoundingBox();if(next!=null)r=Math.min(r,(union.right+next.left)/2);}
        int left=Math.max(0,(int)Math.floor((l-24)/scale)),top=Math.max(0,(int)Math.floor((union.top-padY-24)/scale));
        int right=Math.min(crop.getWidth(),(int)Math.ceil((r-24)/scale)),bottom=Math.min(crop.getHeight(),(int)Math.ceil((union.bottom+padY-24)/scale));
        return right>left&&bottom>top?new Rect(left,top,right,bottom):null;
    }
    Rect boundaryRow(List<Text.Symbol> symbols,Bitmap crop,int attempt){
        int width=crop.getWidth(),height=crop.getHeight();
        float requestedScale=attempt==1?1.5f:2f;
        int scaledWidth=Math.max(1,Math.round(width*requestedScale));
        int scaledHeight=Math.max(1,Math.round(height*requestedScale));
        int top=Integer.MAX_VALUE,bottom=0,previousCenter=-1;
        for(Text.Symbol symbol:symbols){
            Rect box=symbol.getBoundingBox();
            if(box==null||box.isEmpty()||box.left<24||box.right>24+scaledWidth
                ||box.top<24||box.bottom>24+scaledHeight||box.centerX()<=previousCenter)return null;
            previousCenter=box.centerX();
            top=Math.min(top,box.top);
            bottom=Math.max(bottom,box.bottom);
        }
        if(top>=bottom)return null;
        // Use the actual rounded content height from contractImage(), excluding its border.
        int rowTop=(int)Math.floor((top-24)*(double)height/scaledHeight);
        int rowBottom=(int)Math.ceil((bottom-24)*(double)height/scaledHeight);
        int margin=Math.max(4,(int)Math.ceil((rowBottom-rowTop)*0.6));
        int start=rowTop-margin,end=rowBottom+margin;
        if(start<0||end>height||end-start>=height)return null;
        return new Rect(0,start,width,end);
    }
    Rect[] pixelRanges(Bitmap crop,Fields.ContractLayout layout){
        int w=crop.getWidth(),h=crop.getHeight();int[] pixels=new int[w*h];crop.getPixels(pixels,0,w,0,0,w,h);
        List<int[]> glyphs=ConnectedGlyphs.find(pixels,w,h,layout.prefix().length()+8,boundaryFixture?this::boundaryEvent:null);
        if(glyphs.isEmpty())return null;
        int a=layout.prefix().length(),b=a+1;int[] first=glyphs.get(a),last=glyphs.get(b);
        int left=(glyphs.get(a-1)[2]+first[0])/2,right=(last[2]+glyphs.get(b+1)[0])/2;
        int top=Math.min(first[1],last[1]),bottom=Math.max(first[3],last[3]);int pad=Math.max(3,(bottom-top)/4);
        Rect code=new Rect(left,Math.max(0,top-pad),right,Math.min(h,bottom+pad));
        List<int[]> tail=glyphs.subList(b+1,glyphs.size());top=h;bottom=0;for(int[] box:tail){top=Math.min(top,box[1]);bottom=Math.max(bottom,box[3]);}
        int[] finalBox=tail.get(tail.size()-1);
        Rect serial=new Rect(right,Math.max(0,top-pad),Math.min(w,finalBox[2]+pad),Math.min(h,bottom+pad));
        return new Rect[]{code,serial};
    }
    void splitContract(int index,long begin,long loaded,long latinEnd,Bitmap crop,Fields.Result previous,String trace,Text reading,int attempt,List<String> fullReadings){
        String prefix=Fields.observedPrefix(fullReadings);Text.Element seed=null;
        for(Text.TextBlock block:reading.getTextBlocks())for(Text.Line line:block.getLines())for(Text.Element e:line.getElements()){
            Fields.ContractLayout p=Fields.contractLayout(e.getText());
            if(p!=null&&p.prefix().equals(prefix)){
                if(seed!=null){crop.recycle();finishSplitFailure(index,begin,loaded,latinEnd,previous,trace,"영역 후보가 여러 개임");return;}
                seed=e;
            }
        }
        if(prefix.isEmpty()||seed==null){crop.recycle();finishSplitFailure(index,begin,loaded,latinEnd,previous,trace,"분할할 글자 위치를 확인하지 못함");return;}
        List<Text.Symbol> symbols=seed.getSymbols();String value=seed.getText().replaceAll("\\s+","");
        StringBuilder symbolText=new StringBuilder();for(Text.Symbol s:symbols)symbolText.append(s.getText());
        if(symbols.size()!=value.length()||!symbolText.toString().equals(value)){
            crop.recycle();finishSplitFailure(index,begin,loaded,latinEnd,previous,trace,"문자별 위치가 없거나 일치하지 않음");return;
        }
        Fields.ContractLayout layout=Fields.contractLayout(value);
        Rect row=boundaryRow(symbols,crop,attempt);
        regionEvent("boundaryRow "+(row==null?"UNSAFE":row.left+","+row.top+","+row.right+","+row.bottom)+" crop="+crop.getWidth()+"x"+crop.getHeight());
        if(row==null){
            crop.recycle();
            finishSplitFailure(index,begin,loaded,latinEnd,previous,trace,"글자 행의 안전 여백을 확인하지 못함");
            return;
        }
        boundaryEvent("boundary row in contract crop="+row.left+","+row.top+","+row.right+","+row.bottom);
        Bitmap rowImage=Bitmap.createBitmap(crop,row.left,row.top,row.width(),row.height());
        Rect[] ink;
        try{
            saveBoundaryInput(rowImage);
            ink=pixelRanges(rowImage,layout);
        }finally{
            rowImage.recycle();
        }
        if(ink!=null){
            ink[0].offset(row.left,row.top);
            ink[1].offset(row.left,row.top);
        }
        if(ink==null){captureDiagnostic(index,"경계를 확인하지 못한 계약번호 칸",crop);crop.recycle();finishSplitFailure(index,begin,loaded,latinEnd,previous,trace,"실제 글자 경계 확인 불가로 분할 중단");return;}
        Rect codeRect=ink[0],serialRect=ink[1];
        trace+="\n[실제 연결 픽셀로 글자 경계 확인 · 기존 OCR 문자 경계 사용 안 함]";
        if(codeRect==null||serialRect==null){crop.recycle();finishSplitFailure(index,begin,loaded,latinEnd,previous,trace,"분할 범위가 올바르지 않음");return;}
        captureDiagnostic(index,"계약번호 칸 원본",crop);
        Bitmap code=Bitmap.createBitmap(crop,codeRect.left,codeRect.top,codeRect.width(),codeRect.height());
        Bitmap serial=Bitmap.createBitmap(crop,serialRect.left,serialRect.top,serialRect.width(),serialRect.height());crop.recycle();
        List<String> codeReadings=new ArrayList<>();
        readPart(index,code,false,0,codeReadings,trace,(codeResult,codeTrace)->{
            if(codeResult.isEmpty()){
                // A repeated reading may help manual review even when another pass conflicts.
                Set<String> repeatedCodes=new LinkedHashSet<>();
                Set<String> seenCodes=new HashSet<>();
                for(String observed:codeReadings)if(!seenCodes.add(observed))repeatedCodes.add(observed);
                String reason="영문 코드가 반복 판독에서 일치하지 않음";
                if(repeatedCodes.size()!=1){
                    serial.recycle();
                    finishSplitFailure(index,begin,loaded,latinEnd,previous,codeTrace,reason);
                    return;
                }
                String reviewCode=repeatedCodes.iterator().next();
                readPart(index,serial,true,0,new ArrayList<>(),codeTrace,(serialResult,serialTrace)->{
                    if(!serialResult.isEmpty()){
                        String candidate=Fields.contractCandidate(prefix+reviewCode+serialResult);
                        if(!candidate.isEmpty())rememberContractCandidates(List.of(candidate));
                    }
                    finishSplitFailure(index,begin,loaded,latinEnd,previous,serialTrace,reason);
                });
                return;
            }
            readPart(index,serial,true,0,new ArrayList<>(),codeTrace,(serialResult,serialTrace)->{
                String combined=serialResult.isEmpty()?"":Fields.contractCandidate(prefix+codeResult+serialResult);
                if(combined.isEmpty())finishSplitFailure(index,begin,loaded,latinEnd,previous,serialTrace,"끝 숫자가 반복 판독에서 일치하지 않음");
                else {
                    String verified=wholeContractEvidence.size()>1?"":Fields.verifiedSplit(combined,fullReadings);
                    rememberContractCandidates(List.of(combined));
                    if(verified.isEmpty())for(String whole:wholeContractEvidence)if(referenceEvents.length()<80)
                        referenceEvents.put("split-versus-whole differences="+ContractReference.differences(whole,combined));
                    if(verified.isEmpty())finishSplitFailure(index,begin,loaded,latinEnd,previous,serialTrace+"\n[분할 판독 후보: "+combined+" · 확정값 아님]",
                        splitReviewReason(combined,fullReadings,wholeContractEvidence));
                    else finish(index,begin,loaded,latinEnd,SystemClock.elapsedRealtime()-latinEnd,new Fields.Result(verified,previous.vin(),previous.name()),serialTrace+"\n[분할 판독과 전체 번호 반복 판독 일치 · 원본 대조 필요]",true);
                }
            });
        });
    }
    static String splitReviewReason(String candidate,List<String> fullReadings,Set<String> wholeEvidence){
        if(wholeEvidence.stream().anyMatch(observed->!observed.equals(candidate))
            ||fullReadings.stream().map(Fields::observedContract).anyMatch(observed->!observed.isEmpty()&&!observed.equals(candidate))){
            return "전체 판독과 분할 판독의 문자가 다름 · 원본을 대조해 주세요";
        }
        return "전체 번호의 독립 판독 근거가 부족함 · 원본을 대조해 주세요";
    }
    interface PartDone {void accept(String value,String trace);}
    Bitmap partImage(Bitmap part,int attempt){
        // Normalize small field text by height, without changing or guessing characters.
        float scale=Math.max(2f,Math.min(6f,112f/part.getHeight()));int border=48;
        int w=Math.max(1,Math.round(part.getWidth()*scale)),h=Math.max(1,Math.round(part.getHeight()*scale));
        Bitmap output=Bitmap.createBitmap(w+2*border,h+2*border,Bitmap.Config.ARGB_8888);
        Canvas c=new Canvas(output);c.drawColor(0xffffffff);Paint p=new Paint(Paint.FILTER_BITMAP_FLAG);
        if(attempt>0){ColorMatrix gray=new ColorMatrix();gray.setSaturation(0);p.setColorFilter(new ColorMatrixColorFilter(gray));}
        c.drawBitmap(part,null,new Rect(border,border,border+w,border+h),p);
        if(attempt==2){
            int[] pixels=new int[w*h];output.getPixels(pixels,0,w,border,border,w,h);int[] histogram=new int[256];
            for(int color:pixels)histogram[(color>>16)&255]++;
            long sum=0;for(int n=0;n<256;n++)sum+=(long)n*histogram[n];
            long leftSum=0;int leftCount=0,threshold=128;double best=-1;
            for(int n=0;n<255;n++){leftCount+=histogram[n];leftSum+=(long)n*histogram[n];int rightCount=pixels.length-leftCount;
                if(leftCount==0||rightCount==0)continue;double delta=(double)leftSum/leftCount-(double)(sum-leftSum)/rightCount;
                double score=(double)leftCount*rightCount*delta*delta;if(score>best){best=score;threshold=n;}}
            for(int n=0;n<pixels.length;n++)pixels[n]=((pixels[n]>>16)&255)<=threshold?0xff000000:0xffffffff;
            output.setPixels(pixels,0,w,border,border,w,h);
        }
        return output;
    }
    void readPart(int index,Bitmap part,boolean serial,int attempt,List<String> readings,String trace,PartDone done){
        Bitmap variant=partImage(part,attempt);
        if(!serial)captureDiagnostic(index,"영문 구간 재인식 "+(attempt+1)+" · "+(attempt==0?"원본 색상":attempt==1?"회색조":"자동 흑백"),variant);
        latin.process(InputImage.fromBitmap(variant,0)).addOnSuccessListener(t->{
            Set<String> candidates=new LinkedHashSet<>();
            for(Fields.Box b:boxes(t)){
                String s=b.text().replaceAll("\\s+","").toUpperCase(Locale.ROOT);if(serial)s=s.replace('O','0');
                if(s.matches(serial?"[0-9]{6}":"[A-Z][A-Z0-9]"))candidates.add(s);
            }
            if(candidates.size()==1)readings.add(candidates.iterator().next());
            if(referenceEvents.length()<80)referenceEvents.put((serial?"serial":"code")+" pass="+(attempt+1)+" crop="+part.getWidth()+"x"+part.getHeight()+" lengths="+candidates.stream().map(String::length).toList());
            String next=trace+"\n["+(serial?"끝 6자리 숫자":"영문 코드")+"만 재인식 "+(attempt+1)+"]\n"+t.getText();
            variant.recycle();String agreed=Fields.agreedPart(readings,serial);
            if(!agreed.isEmpty()){part.recycle();done.accept(agreed,next);}
            else if(attempt<2)readPart(index,part,serial,attempt+1,readings,next,done);
            else {part.recycle();done.accept("",next);}
        }).addOnFailureListener(e->{variant.recycle();part.recycle();done.accept("",trace+"\n[구간별 재인식 실행 실패]");});
    }
    void finishSplitFailure(int index,long begin,long loaded,long latinEnd,Fields.Result previous,String raw,String reason){
        referenceEvents.put("split outcome="+reason);
        regionEvent("split failed: "+reason);boundaryEvent("split failed: "+reason);finish(index,begin,loaded,latinEnd,SystemClock.elapsedRealtime()-latinEnd,new Fields.Result("",previous.vin(),previous.name()),raw+"\n[계약번호 구간별 확인 실패: "+reason+" · 확인 필요]");
    }
    String merge(String a,String b){if(a.isEmpty())return b;if(b.isEmpty()||a.equals(b))return a;return "";}
    String contractCorrection(String raw,String contract){
        if(contract.isEmpty())return "";
        java.util.regex.Matcher m=java.util.regex.Pattern.compile("(?<![A-Z0-9])[A-Z]{1,2}[0-9]{3,4}[A-Z0-9]{2}[0-9O]{6}(?![A-Z0-9])").matcher(raw.toUpperCase(Locale.ROOT));
        while(m.find()){
            String original=m.group();
            if(original.substring(original.length()-6).contains("O")&&Fields.contractCandidate(original).equals(contract))
                return "\n숫자 구간 O→0 보정: "+original+" → "+contract;
        }return "";
    }
    String vinCorrection(String raw,String vin){
        if(vin.isEmpty())return "";
        for(String line:raw.toUpperCase(Locale.ROOT).split("\\n")){
            String[] parts=line.trim().split("\\s+");
            for(int i=0;i<parts.length;i++)if(parts[i].startsWith("KM")||parts[i].startsWith("KN")){
                String joined="";
                for(int j=i;j<parts.length&&j<i+4;j++){
                    joined+=parts[j];if(joined.length()>17)break;
                    if(joined.length()==17&&joined.substring(11).contains("O")&&Fields.vinCandidate(joined).equals(vin))
                        return "\n차대번호 숫자 구간 O→0 보정: "+joined+" → "+vin;
                }
            }
        }return "";
    }
    void finish(int i,long begin,long loaded,long latinEnd,long retry,Fields.Result r,String raw){
        finish(i,begin,loaded,latinEnd,retry,r,raw,false);
    }
    void finish(int i,long begin,long loaded,long latinEnd,long retry,Fields.Result r,String raw,boolean contractVerified){
        if(getIntent().getBooleanExtra("nativeRequest",false)){diagnosticTrace=raw;returnNative(r,(SystemClock.elapsedRealtime()-begin),contractVerified);return;}
        runOnUiThread(()->{
        double total=(SystemClock.elapsedRealtime()-begin)/1000.;boolean ok=!r.contract().isEmpty()&&!r.vin().isEmpty();if(ok)numberOk++;
        String s=String.format(Locale.KOREA,"사진 %d — %s\n계약번호: %s\n차대번호: %s\n계약자명: %s\n전체 %.3f초 / 불러오기 %.3f초 / 영문 OCR %.3f초 / 재인식 합계 %.3f초",i+1,ok?"번호 형식 통과 · 원본 대조 필요":"확인 필요",show(r.contract()),show(r.vin()),r.name().isEmpty()?(ok?"번호 형식 통과로 생략":"인식하지 못함"):r.name(),total,(loaded-begin)/1000.,(latinEnd-loaded)/1000.,retry/1000.);
        double[] tm=trialTimings.get(i);if(tm!=null&&(tm[2]+tm[3])>0)s+=String.format(Locale.KOREA,"\n계약번호 비교: 기존 보정 %.3f초 + OCR %.3f초 / 수평 보정 %.3f초 + OCR %.3f초\n기존 실패 후 수평 보정을 추가 실행한 시험입니다.",tm[0]/1000.,tm[1]/1000.,tm[2]/1000.,tm[3]/1000.);
        s+=contractCorrection(raw,r.contract());
        s+=vinCorrection(raw,r.vin());
        TextView card=text(results,s,16);if(!ok)card.setTextColor(0xffb3261e);Button original=new Button(this);original.setText("인식 원문 보기");results.addView(original);original.setOnClickListener(v->showRawText(raw));if(diagnosticImages.containsKey(i)){Button inspect=new Button(this);inspect.setText("잘라낸 영문 영역 보기 · 22번");results.addView(inspect);inspect.setOnClickListener(v->showDiagnostic(i));}report.append(s).append("\n\n");process(i+1);
    });}
    void showRawText(String raw){
        TextView content=new TextView(this);
        content.setText(raw);content.setTextSize(16);content.setTextIsSelectable(false);
        int padding=(int)(20*getResources().getDisplayMetrics().density);
        content.setPadding(padding,padding,padding,padding);
        ScrollView scroll=new ScrollView(this);scroll.addView(content);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("OCR 원문")
            .setView(scroll).setNeutralButton("전체 복사",null).setPositiveButton("닫기",null).create();
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->{
            android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            /* Offline test: clipboard export disabled. */
            Toast.makeText(this,"원문 전체를 복사했습니다.",Toast.LENGTH_SHORT).show();
        }));
        dialog.show();
    }
    String show(String s){return s.isEmpty()?"인식 불명확 · 확인 필요":s;}
    void failed(int i,long begin,String message){diagnosticError=message;if(getIntent().getBooleanExtra("nativeRequest",false)){returnNative(new Fields.Result("","",""),SystemClock.elapsedRealtime()-begin);return;}runOnUiThread(()->{String s=String.format(Locale.KOREA,"사진 %d — 실패: %s (%.3f초)",i+1,message,(SystemClock.elapsedRealtime()-begin)/1000.);text(results,s,16).setTextColor(0xffb3261e);report.append(s).append("\n");process(i+1);});}
    void returnNative(Fields.Result result,long millis){returnNative(result,millis,false);}
    void returnNative(Fields.Result result,long millis,boolean contractVerified){
        if(guideOriginal!=null){Bitmap original=guideOriginal;guideOriginal=null;
            if(result.contract().isEmpty()||result.vin().isEmpty()){
                guideFallback=true;recognize(0,guideStarted,SystemClock.elapsedRealtime(),original,false);return;
            }
            original.recycle();
        }
        if(result.contract().isEmpty()&&referenceGlyph!=null&&!referenceUsed&&diagnosticError.isEmpty()){
            referenceUsed=true;readReference(result,millis,contractVerified,0);return;
        }
        releaseReference();
        runOnUiThread(()->{try{
        org.json.JSONObject out=new org.json.JSONObject();out.put("partialTarget",partialTarget()==null?"":partialTarget());out.put("diagnostic",diagnosticResult(result));out.put("contract",result.contract());out.put("vin",result.vin());out.put("customerName",result.name());out.put("nativeMs",millis);out.put("guideFirst",guideTried);out.put("originalFallback",guideFallback);
        // OCR alone does not independently verify the VIN against a trusted source.
        out.put("vinVerified",false);
        out.put("numbersVerified",contractVerified&&partialTarget()==null&&diagnosticError.isEmpty()
            &&!result.contract().isEmpty()&&!result.vin().isEmpty());
        if(result.contract().isEmpty()&&!getIntent().getBooleanExtra("nameOnly",false)){
            out.put("contractReviewRequired",true);
            out.put("contractCrop",reviewContractCrop);
            out.put("contractCandidates",new org.json.JSONArray(displayedContractCandidates()));
            out.put("contractReferenceCandidates",new org.json.JSONArray(referenceCandidates));
            out.put("contractReferenceDiagnostics",referenceEvents);
        }
        if(!result.contract().isEmpty()&&result.vin().isEmpty())out.put("contractCrop",reviewContractCrop);
        out.put("vinCandidates",new org.json.JSONArray(partialVinCandidates.stream().limit(3).toList()));out.put("vinCrop",reviewVinCrop);out.put("nameCrop",reviewNameCrop);
        if(result.contract().isEmpty()&&!getIntent().getBooleanExtra("nameOnly",false))out.put("combinationEvidence",contractSymbolEvidence());
        Intent data=new Intent();data.putExtra("nativeRequestId",getIntent().getStringExtra("nativeRequestId"));data.putExtra("result",out.toString());setResult(RESULT_OK,data);finish();
    }catch(Exception error){setResult(RESULT_CANCELED);finish();}});}
    @Override protected void onDestroy(){super.onDestroy();clearReference();latin.close();korean.close();worker.shutdown();}

 @Override public void startActivity(Intent intent){if(OfflineGate.internal(this,intent))super.startActivity(intent);}
 @Override public void startActivityForResult(Intent intent,int code){if(OfflineGate.internal(this,intent))super.startActivityForResult(intent,code);}
}
