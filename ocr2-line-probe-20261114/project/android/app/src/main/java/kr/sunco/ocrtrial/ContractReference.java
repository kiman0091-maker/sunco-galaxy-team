package kr.sunco.ocrtrial;

final class ContractReference {
    static final int MAX_PASSES = 2;
    private static final String[] PAIRS = {"QO","O0","S5","B8","I1","Z2","G6","D0","T7"};

    static boolean supported(char glyph) {
        for (String pair : PAIRS) if (pair.indexOf(glyph) >= 0) return true;
        return false;
    }

    static String candidate(String seed, int offset, String observed) {
        String text = Fields.compact(observed);
        if (offset < 0 || offset >= seed.length() || text.length() != 1) return "";
        char before = seed.charAt(offset), after = text.charAt(0);
        if (before == after) return "";
        for (String pair : PAIRS) {
            if (pair.indexOf(before) < 0 || pair.indexOf(after) < 0) continue;
            String changed = seed.substring(0, offset) + after + seed.substring(offset + 1);
            return changed.equals(Fields.contractCandidate(changed)) && !Fields.ambiguousPrefix(changed) ? changed : "";
        }
        return "";
    }

    static java.util.List<Integer> differences(String a, String b) {
        var positions = new java.util.ArrayList<Integer>();
        for (int i=0; i<Math.max(a.length(), b.length()); i++)
            if (i>=a.length() || i>=b.length() || a.charAt(i)!=b.charAt(i)) positions.add(i+1);
        return positions;
    }
}
