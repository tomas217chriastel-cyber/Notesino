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
        final String subject;
        final String room;
        final String color; // nullable

        Period(String start, String end, String subject, String room, String color) {
            this.start = start;
            this.end = end;
            this.subject = subject;
            this.room = room;
            this.color = color;
        }
    }

    /** Today's periods that have a subject filled in, in period order. */
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

                JSONObject cell = cells.optJSONObject(dayIdx + "-" + p);
                String subject = cell != null ? cell.optString("subject", "") : "";
                if (subject.trim().length() == 0) continue;

                String room = cell.optString("room", "");
                String color = (cell.has("color") && !cell.isNull("color"))
                        ? cell.optString("color", null) : null;

                out.add(new Period(
                        period.optString("start", ""),
                        period.optString("end", ""),
                        subject,
                        room,
                        color));
            }
        } catch (JSONException e) {
            // Corrupt/old data: show nothing rather than crash the widget.
        }
        return out;
    }
}
