package kr.sunco.ocrtrial;
public final class LevelGeometry {
 private LevelGeometry(){}
 public static double angle(int dx,int dy){return Math.toDegrees(Math.atan2(dy,dx));}
 public static boolean usable(double angle){return Double.isFinite(angle)&&Math.abs(angle)>=0.3&&Math.abs(angle)<=15;}
}
