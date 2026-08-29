package com.notesino.app;

import android.content.Context;
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
}
