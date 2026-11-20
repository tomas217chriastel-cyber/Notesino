package com.notesino.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;

/**
 * Exposed to the page as window.NotesinoNative. The web app calls
 * saveTimetable() every time the Timetable tab changes so the home-screen
 * widget (which cannot run the WebView's JS) can read the same data.
 */
class TimetableBridge {

    private final Context appContext;

    TimetableBridge(Context context) {
        this.appContext = context.getApplicationContext();
    }

    @JavascriptInterface
    public void saveTimetable(String json) {
        if (json == null) return;
        TimetableStore.save(appContext, json);
        TimetableWidgetProvider.refreshAll(appContext);
    }

    /** Opens an http(s) link (e.g. a Google Calendar "create event" link
     *  from the Reminders tab) in the matching app or the browser. */
    @JavascriptInterface
    public void openExternal(String url) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            appContext.startActivity(intent);
        } catch (Exception ignored) {
        }
    }
}
