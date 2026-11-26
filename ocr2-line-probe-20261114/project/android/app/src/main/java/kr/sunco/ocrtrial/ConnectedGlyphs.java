package kr.sunco.ocrtrial;
import java.util.*;
public final class ConnectedGlyphs {
 public static List<int[]> find(int[] pixels,int w,int h,int expected){
  return find(pixels,w,h,expected,null);
 }
 static List<int[]> find(int[] pixels,int w,int h,int expected,java.util.function.Consumer<String> diagnostic){
  int[] gray=new int[pixels.length],hist=new int[256];
  for(int i=0;i<pixels.length;i++){int c=pixels[i];int g=(77*((c>>16)&255)+150*((c>>8)&255)+29*(c&255))>>8;gray[i]=g;hist[g]++;}
  long sum=0;for(int i=0;i<256;i++)sum+=(long)i*hist[i];long ls=0;int lc=0,threshold=128;double best=-1;
  for(int i=0;i<255;i++){lc+=hist[i];ls+=(long)i*hist[i];int rc=pixels.length-lc;if(lc==0||rc==0)continue;double d=(double)ls/lc-(double)(sum-ls)/rc;double score=(double)lc*rc*d*d;if(score>best){best=score;threshold=i;}}
  for(double factor:new double[]{1,.85,.7,.55}){
   int cut=(int)(threshold*factor);boolean[] seen=new boolean[gray.length];int[] queue=new int[gray.length];List<int[]> spans=new ArrayList<>();int components=0;
   for(int pos=0;pos<gray.length;pos++){
    if(seen[pos]||gray[pos]>cut)continue;components++;int head=0,tail=1;queue[0]=pos;seen[pos]=true;int l=pos%w,r=l,t=pos/w,b=t;
    while(head<tail){int at=queue[head++],x=at%w,y=at/w;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);
     for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){int nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;int next=ny*w+nx;if(!seen[next]&&gray[next]<=cut){seen[next]=true;queue[tail++]=next;}}}
    int bw=r-l+1,bh=b-t+1;if(bh>=8&&bh<h*.65&&bw>=2&&bw<bh*1.8&&tail>=8)spans.add(new int[]{l,t,r+1,b+1});
   }
   int sizeFiltered=spans.size();
   String summary=diagnostic==null?null:"factor="+factor+" cut="+cut+" expected="+expected+" connected="+components+" sizeFiltered="+sizeFiltered;
   if(spans.size()<expected){
    if(diagnostic!=null)diagnostic.accept(summary+" rejected=count-low height=not-reached alignment=not-reached gap=not-reached");
    continue;
   }
   int[] heights=spans.stream().mapToInt(a->a[3]-a[1]).sorted().toArray();int median=heights[heights.length/2];
   spans.removeIf(a->a[3]-a[1]<median*.65||a[3]-a[1]>median*1.45);
   if(diagnostic!=null)summary+=" medianHeight="+median+" heightFiltered="+spans.size();
   if(spans.size()!=expected){
    if(diagnostic!=null)diagnostic.accept(summary+" rejected=count-after-height alignment=not-reached gap=not-reached");
    continue;
   }
   spans.sort(Comparator.comparingInt(a->a[0]));
   boolean rowFail=false,gapFail=false;
   for(int n=1;n<spans.size();n++){int[] a=spans.get(n-1),b=spans.get(n);rowFail|=Math.abs((a[1]+a[3])-(b[1]+b[3]))>median;gapFail|=b[0]-a[2]>median*1.5;}
   if(diagnostic!=null)diagnostic.accept(summary+" rowFail="+rowFail+" gapFail="+gapFail);
   if(!rowFail&&!gapFail)return spans;
  }
  return Collections.emptyList();
 }
}
