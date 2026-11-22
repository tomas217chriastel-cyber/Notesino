package com.notesino.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * Reads/writes the timetable JSON shared between the WebView (source of
 * truth, edited in the Timetable tab) and the home-screen widget.
 */
class TimetableStore {

    private static final String PREFS = "notesino_widget";
    private static final String KEY_JSON = "timetable_json";
    private static final String[] DAY_CODES =
            { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" };
    private static final String[] DAY_FULL =
            { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" };

    static void save(Context ctx, String json) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_JSON, json).apply();
    }

    private static String raw(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return prefs.getString(KEY_JSON, null);
    }

    static String todayLabel() {
        return DAY_FULL[Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1];
    }

    static class Period {
        final String start;
        final String end;
        final String subject; // plain text; the web app stores this field as HTML (bold/italic/underline)
        final String room;
        final String teacher;
        final String color; // nullable
        final boolean free;

        Period(String start, String end, String subject, String room, String teacher, String color, boolean free) {
            this.start = start;
            this.end = end;
            this.subject = subject;
            this.room = room;
            this.teacher = teacher;
            this.color = color;
            this.free = free;
        }
    }

    /** Strips the small set of tags the web app's rich-text subject field can
        produce (b/i/u only) and unescapes the handful of entities that come
        with them. Not a general HTML parser - deliberately just enough for
        this one controlled field, since a widget row is plain text anyway. */
    private static String stripHtml(String html) {
        if (html == null) return "";
        String text = html
                .replaceAll("<br\\s*/?>", " ")
                .replaceAll("<[^>]*>", "");
        text = text
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'");
        return text.trim();
    }

    /** Mirrors the web app's startOfWeekMonday(): midnight of the Monday
        on or before the given calendar's date. */
    private static long startOfWeekMondayMillis(Calendar cal) {
        Calendar c = (Calendar) cal.clone();
        int dow = c.get(Calendar.DAY_OF_WEEK); // Calendar.SUNDAY=1 .. Calendar.SATURDAY=7
        int diff = (dow == Calendar.SUNDAY) ? -6 : (Calendar.MONDAY - dow);
        c.add(Calendar.DAY_OF_MONTH, diff);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** Mirrors the web app's weekLetterForDate(): which of the alternating
        Week A / Week B schedules today falls on. Without this the widget
        always showed Week A's cells, even on a real Week B day. */
    private static String weekLetterForToday(JSONObject rotation) {
        if (rotation == null || !rotation.optBoolean("enabled", false)) return "A";
        String anchorDate = rotation.optString("anchorDate", "");
        String[] parts = anchorDate.split("-");
        if (parts.length != 3) return "A";
        try {
            Calendar anchor = Calendar.getInstance();
            anchor.clear();
            anchor.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]));
            long todayMonday = startOfWeekMondayMillis(Calendar.getInstance());
            long anchorMonday = startOfWeekMondayMillis(anchor);
            long diffWeeks = Math.round((todayMonday - anchorMonday) / (7.0 * 86400000.0));
            long mod = ((diffWeeks % 2) + 2) % 2;
            return mod == 0 ? "A" : "B";
        } catch (NumberFormatException e) {
            return "A";
        }
    }

    /** Today's periods that have a subject filled in, or are explicitly
        marked free, in period order. */
    static List<Period> todaysPeriods(Context ctx) {
        List<Period> out = new ArrayList<>();
        String rawJson = raw(ctx);
        if (rawJson == null) return out;

        try {
            JSONObject root = new JSONObject(rawJson);
            JSONArray days = root.optJSONArray("days");
            JSONArray periods = root.optJSONArray("periods");
            JSONObject cells = root.optJSONObject("cells");
            if (days == null || periods == null || cells == null) return out;

            // On an alternating Week A/B schedule, today might be a Week B
            // day -- fall back to Week A's cells whenever there's no
            // rotation (or no Week B data) so a plain, non-alternating
            // timetable behaves exactly as before.
            JSONObject cellsB = root.optJSONObject("cellsB");
            boolean useB = "B".equals(weekLetterForToday(root.optJSONObject("rotation")))
                    && cellsB != null && cellsB.length() > 0;
            JSONObject activeCells = useB ? cellsB : cells;

            String todayCode = DAY_CODES[Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1];
            int dayIdx = -1;
            for (int i = 0; i < days.length(); i++) {
                if (todayCode.equals(days.optString(i))) {
                    dayIdx = i;
                    break;
                }
            }
            if (dayIdx == -1) return out;

            for (int p = 0; p < periods.length(); p++) {
                JSONObject period = periods.optJSONObject(p);
                if (period == null) continue;

                JSONObject cell = activeCells.optJSONObject(dayIdx + "-" + p);
                boolean free = cell != null && cell.optBoolean("free", false);
                String subject = stripHtml(cell != null ? cell.optString("subject", "") : "");
                if (subject.length() == 0 && !free) continue;

                String room = cell != null ? cell.optString("room", "") : "";
                String teacher = cell != null ? cell.optString("teacher", "") : "";
                String color = (cell != null && cell.has("color") && !cell.isNull("color"))
                        ? cell.optString("color", null) : null;

                out.add(new Period(
                        period.optString("start", ""),
                        period.optString("end", ""),
                        subject,
                        room,
                        teacher,
                        color,
                        free));
            }
        } catch (JSONException e) {
            // Corrupt/old data: show nothing rather than crash the widget.
        }
        return out;
    }
}
