package kr.sunco.ocrtrial;

import java.util.*;
import java.util.regex.*;

/** Spatial candidates; O/0 normalization is limited to numeric serial suffixes. */
public final class Fields {
    public record Box(String text, int left, int top, int right, int bottom) {
        int height(){ return Math.max(1,bottom-top); }
        int cx(){ return (left+right)/2; }
    }
    public record Result(String contract, String vin, String name) {}
    public record ContractParts(String prefix,String code,String serial) {}
    public static ContractParts parts(String contract){
        String value=contractCandidate(contract);if(value.isEmpty())return null;
        return new ContractParts(value.substring(0,value.length()-8),value.substring(value.length()-8,value.length()-6),value.substring(value.length()-6));
    }
    public static String agreedPart(List<String> readings,boolean serial){
        Set<String> distinct=new LinkedHashSet<>();int count=0;
        for(String s:readings){String v=compact(s);if(serial)v=v.replace('O','0');
            if(v.matches(serial?"[0-9]{6}":"[A-Z][A-Z0-9]")){distinct.add(v);count++;}}
        return count>=2&&distinct.size()==1?distinct.iterator().next():"";
    }
    public static String agreedPrefix(List<String> contracts){
        Set<String> prefixes=new LinkedHashSet<>();for(String s:contracts){ContractParts p=parts(s);if(p!=null)prefixes.add(p.prefix());}
        return one(prefixes);
    }
    public static String agreedContract(List<String> readings){
        Set<String> distinct=new LinkedHashSet<>();int valid=0;
        for(String value:readings){
            String observed=observedContract(value);
            if(!observed.isEmpty())distinct.add(observed);
            if(!contractCandidate(value).isEmpty())valid++;
        }
        String agreed=valid>=2?one(distinct):"";
        return ambiguousPrefix(agreed)?"":contractCandidate(agreed);
    }
    static String observedContract(String value){
        String s=compact(value);
        if(contractLayout(s)==null)return "";
        int suffix=s.length()-6;
        return s.substring(0,suffix)+s.substring(suffix).replace('O','0');
    }
    static boolean ambiguousPrefix(String value){
        ContractLayout layout=contractLayout(value);
        return layout!=null && layout.prefix().matches("[A-Z]O[0-9]{3}");
    }
    /** Split fragments are diagnostic evidence, never sufficient for confirmation alone. */
    public static String verifiedSplit(String candidate,List<String> wholeReadings){
        String normalized=contractCandidate(candidate),whole=agreedContract(wholeReadings);
        return !normalized.isEmpty()&&normalized.equals(whole)?normalized:"";
    }
    /** For locating retries only. Invalid model letters never become accepted numbers. */
    public record ContractLayout(String prefix,int codeStart,int codeEnd,int serialStart) {}
    public static ContractLayout contractLayout(String text){
        String s=compact(text);Matcher m=Pattern.compile("([A-Z][0-9]{4}|[A-Z]{2}[0-9]{3})([A-Z0-9]{2,3})([0-9O]{6})").matcher(s);
        return m.matches()?new ContractLayout(m.group(1),m.start(2),m.end(2),m.start(3)):null;
    }
    public static String observedPrefix(List<String> readings){
        Set<String> values=new LinkedHashSet<>();for(String text:readings){ContractLayout p=contractLayout(text);if(p!=null)values.add(p.prefix());}return one(values);
    }
    /** Prefix noise is excluded only at a punctuation boundary, using actual glyph boxes in the caller. */
    public static int vinFragmentStart(String text){
        Matcher m=Pattern.compile("(?:^|[^A-Z0-9])((?:KM|KN)[A-Z0-9]{2,15})$").matcher(compact(text));
        return m.find()?m.start(1):-1;
    }
    public static Box contractRegion(List<Box> boxes){
        return contractRegion(boxes,0,0,null);
    }
    static Box contractRegion(List<Box> boxes,int imageWidth,int imageHeight,java.util.function.Consumer<String> diagnostic){
        Box labeled=regionBelow(boxes,"계약번호");
        List<Box> candidates=boxes.stream().filter(b->contractLayout(b.text())!=null).toList();
        if(diagnostic!=null){
            diagnostic.accept("labelRegion="+regionCoordinates(labeled)+" candidateCount="+candidates.size());
            for(int i=0;i<Math.min(12,candidates.size());i++){
                diagnostic.accept("candidate "+i+"="+regionCoordinates(candidates.get(i)));
            }
        }
        if(candidates.size()!=1){
            if(diagnostic!=null)diagnostic.accept("branch=LABEL reason=candidate-count");
            return labeled;
        }
        Box value=candidates.get(0);
        if(labeled==null){
            if(diagnostic!=null)diagnostic.accept("branch=VALUE reason=no-label-region");
            return value;
        }
        boolean sameRow=value.bottom()>labeled.top()&&value.top()<labeled.bottom();
        boolean sameColumn=value.right()>labeled.left()&&value.left()<labeled.right();
        if(!sameRow||!sameColumn){
            if(diagnostic!=null)diagnostic.accept("branch=LABEL reason=non-overlap sameRow="+sameRow+" sameColumn="+sameColumn);
            return labeled;
        }
        int pad=Math.max(8,value.height()/2), verticalPad=contractCandidate(value.text()).isEmpty()?contractRowRetryMargin(value):pad/2;
        if(value.left()>=labeled.left()&&value.top()>=labeled.top()
            &&value.right()<=labeled.right()&&value.bottom()<=labeled.bottom()
            &&value.right()>value.left()&&value.bottom()>value.top()
            &&value.left()>=pad&&value.top()>=verticalPad
            &&value.right()<=imageWidth-pad&&value.bottom()<=imageHeight-verticalPad
            &&compact(value.text()).length()==13){
            if(diagnostic!=null)diagnostic.accept("branch=CONTAINED_VALUE reason=single-13-glyph-row-with-full-padding");
            return value;
        }
        if(diagnostic!=null)diagnostic.accept("branch=UNION reason=overlap");
        return new Box("계약번호",Math.min(value.left(),labeled.left()),Math.min(value.top(),labeled.top()),
            Math.max(value.right(),labeled.right()),Math.max(value.bottom(),labeled.bottom()));
    }
    // Keep real source pixels for the later boundary-row check on a candidate crop.
    static int contractRowRetryMargin(Box value) {
        return Math.max(4, (int)Math.ceil(value.height() * 0.8));
    }
    // The boundary check still measures the actual OCR glyph row after cropping.
    static int contractSourceMargin(Box area,List<Box> boxes,int x,int y,int right,int bottom,int imageHeight,int originalMargin) {
        if(contractCandidate(area.text()).isEmpty() || area.top()<0 || area.bottom()>imageHeight
            || area.top()>=area.bottom() || right<=x)return originalMargin;
        long candidates=boxes.stream().filter(b->contractLayout(b.text())!=null).distinct().count();
        if(candidates!=1 || !boxes.contains(area))return originalMargin;
        int needed=Math.max(4,(int)Math.ceil(area.height()*0.6));
        if(needed<=originalMargin || area.top()<needed || imageHeight-area.bottom()<needed)return originalMargin;
        int top=area.top()-needed, end=area.bottom()+needed;
        for(Box other:boxes){
            if(other.equals(area) || other.right()<=x || other.left()>=right)continue;
            boolean entersTop=other.top()<y && other.bottom()>top;
            boolean entersBottom=other.bottom()>bottom && other.top()<end;
            if(entersTop||entersBottom)return originalMargin;
        }
        return needed;
    }
    static String regionCoordinates(Box box){
        return box==null?"none":box.left()+","+box.top()+","+box.right()+","+box.bottom();
    }
    static final Pattern CONTRACT=Pattern.compile("(?:[A-Z][0-9]{4}|[A-Z]{2}[0-9]{3})[A-Z][A-Z0-9][0-9]{6}");
    static final Pattern VIN=Pattern.compile("[A-HJ-NPR-Z0-9]{17}");
    static String compact(String s){return s.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);}
    static String one(Set<String> values){return values.size()==1?values.iterator().next():"";}
    /** User-confirmed contract suffix is six digits. Only O in that suffix is normalized. */
    public static String contractCandidate(String text){
        String s=compact(text);
        if(CONTRACT.matcher(s).matches())return s;
        if(!s.matches("(?:[A-Z][0-9]{4}|[A-Z]{2}[0-9]{3})[A-Z][A-Z0-9][0-9O]{6}"))return "";
        String value=s.substring(0,s.length()-6)+s.substring(s.length()-6).replace('O','0');
        return CONTRACT.matcher(value).matches()?value:"";
    }
    static Box mainLabel(List<Box> boxes,String title){
        List<Box> labels=new ArrayList<>(boxes.stream().filter(b->compact(b.text()).equals(title)).toList());
        if(labels.size()==1)return labels.get(0);
        if(labels.isEmpty())return null;
        labels.sort(Comparator.comparingInt(Box::height).reversed());
        // Smaller text from a second sheet must not compete with the main document.
        return labels.get(0).height()>labels.get(1).height()*1.2?labels.get(0):null;
    }
    public static Box regionBelow(List<Box> boxes,String title){
        Box a=mainLabel(boxes,title);
        if(title.equals("차대번호")){
            Box contract=mainLabel(boxes,"계약번호");
            if(contract!=null){
                List<Box> local=boxes.stream().filter(b->compact(b.text()).equals(title)
                    && b.top()>contract.bottom() && b.top()-contract.bottom()<contract.height()*10
                    && b.height()>contract.height()*0.55).toList();
                if(local.size()==1)a=local.get(0);
            }
        }
        if(a==null)return null;
        int left=a.left()-a.height()*2,right=a.right()+a.height()*(title.equals("차대번호")?4:2);
        for(Box b:boxes){
                if(b==a || !b.text().matches(".*(번호|자명|유형|출고|생년|지역|서비스|품목).*"))continue;
            if(Math.abs((a.top()+a.bottom())-(b.top()+b.bottom()))>Math.max(a.height(),b.height())*2)continue;
            if(b.cx()>a.cx())right=Math.min(right,(a.right()+b.left())/2);
            if(b.cx()<a.cx())left=Math.max(left,(b.right()+a.left())/2);
        }
        return new Box(title,left,a.bottom(),right,a.bottom()+a.height()*3);
    }
    /** Crop using observed VIN fragments, including invalid letters, without correcting them. */
    public static Box vinRegion(List<Box> boxes){return vinRegion(boxes,0);}
    public static Box vinRegion(List<Box> boxes,int attempt){
        Box area=regionBelow(boxes,"차대번호");
        if(area==null)return null;
        List<Box> seeds=boxes.stream().filter(b->{String t=compact(b.text());
            return t.matches("(?:KM|KN)[A-Z0-9]{2,15}")&&inside(b,area);}).toList();
        if(seeds.size()!=1)return area;
        Box first=seeds.get(0),last=first;int length=compact(first.text()).length();
        int left=first.left(),top=first.top(),right=first.right(),bottom=first.bottom();
        while(length<17){
            Box nearest=null;
            for(Box b:boxes){String t=compact(b.text());
                if(!t.matches("[A-Z0-9]+")||length+t.length()>17)continue;
                int gap=b.left()-last.right();
                if(gap<0||gap>Math.max(last.height(),b.height())*4
                    ||Math.abs((b.top()+b.bottom())-(last.top()+last.bottom()))>Math.max(last.height(),b.height()))continue;
                if(nearest==null||b.left()<nearest.left())nearest=b;
            }
            if(nearest==null)break;
            length+=compact(nearest.text()).length();last=nearest;
            top=Math.min(top,last.top());right=Math.max(right,last.right());bottom=Math.max(bottom,last.bottom());
        }
        int pad=Math.max(8,bottom-top);int extra=Math.max(0,Math.min(attempt,2))*(bottom-top);
        int cropRight=right+pad+extra;
        // Stop at the next heading cell, never expand into its temporary number.
        for(Box b:boxes)if(compact(b.text()).equals("임시번호")&&b.left()>first.right()&&b.top()<first.top())cropRight=Math.min(cropRight,b.left());
        return new Box("차대번호",left-pad,top-pad,cropRight,bottom+pad);
    }
    public static String vinCandidate(String text){
        String s=compact(text);
        if(s.length()!=17||!(s.startsWith("KM")||s.startsWith("KN")))return "";
        if(!s.substring(11).matches("[0-9O]{6}"))return "";
        s=s.substring(0,11)+s.substring(11).replace('O','0');
        return VIN.matcher(s).matches()?s:"";
    }
    static boolean inside(Box b,Box area){return area==null || (b.top()>=area.top()-b.height()/2 && b.top()<area.bottom()
        && b.cx()>=area.left() && b.cx()<area.right());}
    static void vinChain(List<Box> boxes,Box last,String value,int count,Box area,Set<String> found){
        String candidate=vinCandidate(value);if(!candidate.isEmpty()){found.add(candidate);return;}
        if(value.length()>=17||count>=4)return;
        int nearest=Integer.MAX_VALUE;List<Box> next=new ArrayList<>();
        for(Box b:boxes){String part=compact(b.text());
            if(!part.matches("[A-Z0-9]+")||value.length()+part.length()>17||!inside(b,area))continue;
            int gap=b.left()-last.right();
            if(gap<0||gap>Math.max(last.height(),b.height())*4
                ||Math.abs((b.top()+b.bottom())-(last.top()+last.bottom()))>Math.max(last.height(),b.height()))continue;
            if(gap<nearest){nearest=gap;next.clear();next.add(b);}else if(gap==nearest)next.add(b);
        }
        for(Box b:next)vinChain(boxes,b,value+compact(b.text()),count+1,area,found);
    }
    public static Result extract(List<Box> boxes) {
        Set<String> contracts=new LinkedHashSet<>(), vins=new LinkedHashSet<>();
        Box contractArea=regionBelow(boxes,"계약번호"),vinArea=regionBelow(boxes,"차대번호");
        for(Box a:boxes){
            String s=compact(a.text());
            String contract=contractCandidate(s);
            if(!contract.isEmpty()&&inside(a,contractArea))contracts.add(contract);
            if(inside(a,vinArea)&&s.matches("[A-Z0-9]+")&&(s.startsWith("KM")||s.startsWith("KN")))vinChain(boxes,a,s,1,vinArea,vins);
        }
        String name="";Box region=regionBelow(boxes,"계약자명");
        if(region!=null){
            // Reject headings themselves, not legitimate names containing heading words.
            Set<String> headings=Set.of("계약자명","계약번호","차대번호","인수자명","인수유형",
                "생년월일","생년월일(인수자)","출고일","출하일","배달지역","판매코드",
                "임시번호","서비스품목","담당","담당자","영업담당","카마스터","연락처","연락처1");
            List<Box> below=new ArrayList<>();
            boolean crossed=false;
            for(Box b:boxes){
                String token=compact(b.text()).replaceAll("[:：]+$", "");
                if(headings.contains(token))continue;
                if(b.top()<region.top()-2 || b.top()>=region.bottom()
                    || b.cx()<region.left() || b.cx()>=region.right()
                    || b.right()-b.left()>2*(region.right()-region.left()))continue;
                if(!b.text().matches(".*[가-힣].*|[0-9]+|[()㈜]+"))continue;
                // A line spanning the next cell cannot safely identify its owner.
                if(b.left()<region.left() || b.right()>region.right()){crossed=true;continue;}
                below.add(b);
            }
            below.sort(Comparator.comparingInt(Box::top));
            if(!crossed && !below.isEmpty()){
                Box first=below.get(0);List<Box> row=new ArrayList<>();
                boolean ambiguous=false;
                for(Box b:below){
                    if(Math.abs(b.top()-first.top())<first.height()/2)row.add(b);
                    else ambiguous=true; // Do not choose the first of several possible names.
                }
                row.sort(Comparator.comparingInt(Box::left));
                for(int i=1;i<row.size();i++){
                    Box previous=row.get(i-1),current=row.get(i);
                    if(current.left()-previous.right()>Math.min(previous.height(),current.height()))ambiguous=true;
                }
                if(!ambiguous && row.stream().anyMatch(b->!compact(b.text()).matches("\\(주\\)|㈜|\\(유\\)|주식회사|유한회사") && b.text().matches(".*[가-힣].*")))
                    name=String.join(" ",row.stream().map(Box::text).toList());
            }
        }
        return new Result(one(contracts),one(vins),name);
    }
}
