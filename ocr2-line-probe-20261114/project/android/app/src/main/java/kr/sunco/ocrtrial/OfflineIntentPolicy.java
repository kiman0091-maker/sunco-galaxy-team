package kr.sunco.ocrtrial;
/** Pure policy, also compiled in non-Android tests. */
public final class OfflineIntentPolicy {
 public static boolean allowed(String own,String target,String name){
  return own!=null&&own.equals(target)&&("kr.sunco.ocrtrial.MainActivity".equals(name)||"kr.sunco.ocrtrial.BurstCameraActivity".equals(name));
 }
}
