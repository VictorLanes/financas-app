package com.victorlanes.financas.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import com.victorlanes.financas.R;

/** Widget "Saldo": saldo atual + receitas e despesas do mês. */
public class BalanceWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateWidgets(c, m, ids);
    }

    static void updateWidgets(Context c, AppWidgetManager m, int[] ids) {
        WidgetStore.Data d = WidgetStore.load(c);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_balance);
            if (!d.ok) {
                v.setTextViewText(R.id.bal_value, "Abra o app");
                v.setTextViewText(R.id.bal_income, "–");
                v.setTextViewText(R.id.bal_expense, "–");
            } else {
                v.setTextViewText(R.id.bal_value, WidgetStore.money(d.balance, d.hide));
                v.setTextViewText(R.id.bal_month, d.month);
                v.setTextViewText(R.id.bal_income, WidgetStore.money(d.income, d.hide));
                v.setTextViewText(R.id.bal_expense, WidgetStore.money(d.expense, d.hide));
            }
            v.setOnClickPendingIntent(R.id.widget_root, Widgets.open(c, "financas://inicio", 1));
            v.setOnClickPendingIntent(R.id.bal_add, Widgets.open(c, "financas://novo", 2));
            m.updateAppWidget(id, v);
        }
    }
}
