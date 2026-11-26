package kr.sunco.ocrtrial;

import android.graphics.*;

/** Coordinates start in the displayed TextureView and end in the oriented JPEG. */
final class GuideGeometry {
    static RectF frame(float width,float height){
        float ratio=width>height?30f/21f:21f/30f;
        float w=width*.88f,h=w/ratio;
        if(h>height*.90f){h=height*.90f;w=h*ratio;}
        return new RectF((width-w)/2,(height-h)/2,(width+w)/2,(height+h)/2);
    }
    static float[] map(RectF guide,float offsetX,float offsetY,float viewW,float viewH,
                       Matrix texture,int jpegRotation){
        Matrix inverse=new Matrix();if(viewW<=0||viewH<=0||!texture.invert(inverse))return null;
        float[] points={guide.left-offsetX,guide.top-offsetY,guide.right-offsetX,guide.top-offsetY,
                        guide.right-offsetX,guide.bottom-offsetY,guide.left-offsetX,guide.bottom-offsetY};
        inverse.mapPoints(points);
        float left=1,top=1,right=0,bottom=0;
        for(int i=0;i<points.length;i+=2){
            float x=points[i]/viewW,y=points[i+1]/viewH,a=x,b=y;
            if(jpegRotation==90){a=1-y;b=x;}else if(jpegRotation==180){a=1-x;b=1-y;}else if(jpegRotation==270){a=y;b=1-x;}
            left=Math.min(left,a);top=Math.min(top,b);right=Math.max(right,a);bottom=Math.max(bottom,b);
        }
        if(left<-.01||top<-.01||right>1.01||bottom>1.01||right-left<.1||bottom-top<.1)return null;
        return new float[]{Math.max(0,left),Math.max(0,top),Math.min(1,right),Math.min(1,bottom)};
    }
}
