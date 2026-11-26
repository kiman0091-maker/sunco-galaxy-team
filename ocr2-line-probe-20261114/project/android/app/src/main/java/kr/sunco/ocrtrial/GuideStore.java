package kr.sunco.ocrtrial;

import android.content.Context;
import java.security.MessageDigest;

/** Only geometry is retained; keys identify unchanged original JPEG bytes. */
final class GuideStore {
    static String key(byte[] bytes)throws Exception{
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder out=new StringBuilder();
        for(byte b:digest)out.append(String.format("%02x",b&255));return out.toString();
    }
    static void put(Context context,byte[] bytes,float[] rect)throws Exception{
        if(rect==null)return;
        String value=rect[0]+","+rect[1]+","+rect[2]+","+rect[3];
        context.getSharedPreferences("capture-guide",0).edit().putString(key(bytes),value).apply();
    }
    static float[] get(Context context,byte[] bytes)throws Exception{
        String value=context.getSharedPreferences("capture-guide",0).getString(key(bytes),null);
        if(value==null)return null;String[] parts=value.split(",");if(parts.length!=4)return null;
        float[] rect=new float[4];for(int n=0;n<4;n++){rect[n]=Float.parseFloat(parts[n]);if(!Float.isFinite(rect[n])||rect[n]<0||rect[n]>1)return null;}
        return rect;
    }
}
