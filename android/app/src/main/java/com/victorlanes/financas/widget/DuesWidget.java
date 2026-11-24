package com.victorlanes.financas.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

import com.victorlanes.financas.MainActivity;
import com.victorlanes.financas.R;

/** Widget "Próximos vencimentos": boletos, faturas e parcelas. */
public class DuesWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateWidgets(c, m, ids);
        m.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        String a = intent.getAction();
        if (Intent.ACTION_DATE_CHANGED.equals(a) || Intent.ACTION_TIME_CHANGED.equals(a) || Intent.ACTION_TIMEZONE_CHANGED.equals(a)) Widgets.updateAll(c);
    }

    static void updateWidgets(Context c, AppWidgetManager m, int[] ids) {
        WidgetStore.Data d = WidgetStore.load(c);
        int late = 0;
        double lateSum = 0;
        for (WidgetStore.Item it : d.items) if (!it.incoming && WidgetStore.daysUntil(it.due) < 0) { late++; lateSum += it.amount; }
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_dues);
            String sub = !d.ok ? "Abra o app" : late > 0 ? late + (late == 1 ? " vencida · " : " vencidas · ") + WidgetStore.money(lateSum, d.hide)
                : d.items.isEmpty() ? "Nada para pagar 🎉" : d.items.size() + " nos próximos 45 dias";
            v.setTextViewText(R.id.dues_sub, sub);
            v.setTextColor(R.id.dues_sub, late > 0 ? 0xFFE11D48 : c.getColor(R.color.widget_muted));

            Intent svc = new Intent(c, DuesWidgetService.class);
            svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
            v.setRemoteAdapter(R.id.widget_list, svc);
            v.setEmptyView(R.id.widget_list, R.id.widget_empty);

            Intent tpl = new Intent(Intent.ACTION_VIEW, Uri.parse("financas://contas"), c, MainActivity.class);
            tpl.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            v.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(c, 10, tpl, fl));

            v.setOnClickPendingIntent(R.id.dues_header, Widgets.open(c, "financas://contas", 3));
            v.setOnClickPendingIntent(R.id.widget_empty, Widgets.open(c, "financas://contas", 3));
            v.setOnClickPendingIntent(R.id.dues_add, Widgets.open(c, "financas://novo", 4));
            m.updateAppWidget(id, v);
        }
    }
}
