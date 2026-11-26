package kr.sunco.ocrtrial;
import java.util.*;
public final class InkColumns {
    private InkColumns(){}
    public static List<int[]> spans(int[] columns,int minInk,int minWidth){
        List<int[]> result=new ArrayList<>();int start=-1;
        for(int x=0;x<=columns.length;x++){
            boolean ink=x<columns.length&&columns[x]>=minInk;
            if(ink&&start<0)start=x;
            if(!ink&&start>=0){if(x-start>=minWidth)result.add(new int[]{start,x});start=-1;}
        }
        return result;
    }
}
