package com.notesino.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

public class TimetableWidgetProvider extends AppWidgetProvider {

    static void refreshAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName me = new ComponentName(context, TimetableWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(me);
        if (ids.length == 0) return;
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        for (int id : ids) {
            updateOne(context, mgr, id);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateOne(context, appWidgetManager, id);
        }
    }

    private static void updateOne(Context context, AppWidgetManager mgr, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_timetable);
        views.setTextViewText(R.id.widget_title, "Today — " + TimetableStore.todayLabel());

        Intent svcIntent = new Intent(context, TimetableRemoteViewsService.class);
        svcIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svcIntent.setData(Uri.parse(svcIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, svcIntent);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        Intent openApp = new Intent(context, MainActivity.class);
        openApp.putExtra("open_timetable", true);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                context, widgetId, openApp, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widget_title, pi);
        views.setPendingIntentTemplate(R.id.widget_list, pi);

        mgr.updateAppWidget(widgetId, views);
    }
}
