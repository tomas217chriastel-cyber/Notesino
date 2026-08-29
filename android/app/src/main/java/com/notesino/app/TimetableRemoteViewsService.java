package com.notesino.app;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.List;

public class TimetableRemoteViewsService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    private static class Factory implements RemoteViewsFactory {

        private final Context context;
        private List<TimetableStore.Period> periods;

        Factory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDataSetChanged() {
            periods = TimetableStore.todaysPeriods(context);
        }

        @Override
        public void onDestroy() {
        }

        @Override
        public int getCount() {
            return periods == null ? 0 : periods.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_timetable_item);
            TimetableStore.Period p = periods.get(position);

            String timeLabel = p.end != null && p.end.length() > 0 ? p.start + "–" + p.end : p.start;
            row.setTextViewText(R.id.item_time, timeLabel);
            row.setTextViewText(R.id.item_subject, p.subject);
            row.setTextViewText(R.id.item_room, p.room);
            row.setViewVisibility(R.id.item_room,
                    p.room != null && p.room.trim().length() > 0 ? View.VISIBLE : View.GONE);

            int color;
            try {
                color = p.color != null ? Color.parseColor(p.color) : Color.parseColor("#55FFFFFF");
            } catch (IllegalArgumentException e) {
                color = Color.parseColor("#55FFFFFF");
            }
            row.setInt(R.id.item_color, "setBackgroundColor", color);
            row.setOnClickFillInIntent(R.id.widget_item_root, new Intent());
            return row;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }
    }
}
