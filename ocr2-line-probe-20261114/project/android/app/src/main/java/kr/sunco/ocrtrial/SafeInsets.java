package kr.sunco.ocrtrial;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.graphics.Insets;
public final class SafeInsets {
 private SafeInsets(){}
 public static void apply(View view,int marginDp){
  int pad=Math.round(marginDp*view.getResources().getDisplayMetrics().density);
  view.setOnApplyWindowInsetsListener((v,insets)->{
   int left,top,right,bottom;
   if(Build.VERSION.SDK_INT>=30){Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());left=bars.left;top=bars.top;right=bars.right;bottom=bars.bottom;}
   else {left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();}
   v.setPadding(left+pad,top+pad,right+pad,bottom+pad);
   return insets;
  });
  view.requestApplyInsets();
 }
}
