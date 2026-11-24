package com.victorlanes.financas.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import com.victorlanes.financas.R;

public class QuickAddWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateWidgets(c, m, ids);
    }

    static void updateWidgets(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quickadd);
            v.setOnClickPendingIntent(R.id.widget_root, Widgets.open(c, "financas://novo", 5));
            m.updateAppWidget(id, v);
        }
    }
}
