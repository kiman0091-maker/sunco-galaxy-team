package kr.sunco.ocrtrial;
import android.app.Activity;
import android.content.Intent;
/** Only explicit in-package OCR and camera activities may launch. */
public final class OfflineGate {
    static int blocked=0;
    static boolean internal(Activity activity,Intent intent){
        if(intent!=null&&intent.getComponent()!=null&&OfflineIntentPolicy.allowed(activity.getPackageName(),intent.getComponent().getPackageName(),intent.getComponent().getClassName()))return true;
        blocked++;return false;
    }
}
