package com.victorlanes.financas.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import com.victorlanes.financas.MainActivity;
import com.victorlanes.financas.R;

public class Widgets {
    public static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] bal = m.getAppWidgetIds(new ComponentName(c, BalanceWidget.class));
        if (bal.length > 0) BalanceWidget.updateWidgets(c, m, bal);
        int[] dues = m.getAppWidgetIds(new ComponentName(c, DuesWidget.class));
        if (dues.length > 0) {
            DuesWidget.updateWidgets(c, m, dues);
            m.notifyAppWidgetViewDataChanged(dues, R.id.widget_list);
        }
        int[] quick = m.getAppWidgetIds(new ComponentName(c, QuickAddWidget.class));
        if (quick.length > 0) QuickAddWidget.updateWidgets(c, m, quick);
    }

    /** Abre o app num link interno: financas://novo, financas://contas, financas://inicio */
    public static PendingIntent open(Context c, String link, int code) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(link), c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
