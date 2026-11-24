package com.victorlanes.financas.widget;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.victorlanes.financas.R;

import java.util.ArrayList;
import java.util.List;

public class DuesWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Factory implements RemoteViewsFactory {
        private final Context c;
        private List<WidgetStore.Item> items = new ArrayList<>();
        private boolean hide;

        Factory(Context c) { this.c = c; }

        @Override public void onCreate() {}
        @Override public void onDestroy() {}

        @Override
        public void onDataSetChanged() {
            WidgetStore.Data d = WidgetStore.load(c);
            items = d.items;
            hide = d.hide;
        }

        @Override public int getCount() { return items.size(); }

        @Override
        public RemoteViews getViewAt(int pos) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_dues_item);
            if (pos >= items.size()) return v;
            WidgetStore.Item it = items.get(pos);
            int days = WidgetStore.daysUntil(it.due);
            v.setTextViewText(R.id.item_title, it.title);
            v.setTextViewText(R.id.item_due, WidgetStore.dueLabel(it.due));
            int dueColor = days < 0 ? 0xFFE11D48 : days == 0 ? 0xFFEA580C : days <= 3 ? 0xFFD97706 : c.getColor(R.color.widget_muted);
            v.setTextColor(R.id.item_due, dueColor);
            v.setTextViewText(R.id.item_amount, (it.incoming ? "+ " : "") + WidgetStore.money(it.amount, hide));
            v.setTextColor(R.id.item_amount, it.incoming ? 0xFF16A34A : c.getColor(R.color.widget_text));
            v.setInt(R.id.item_bar, "setColorFilter", it.incoming ? 0xFF16A34A : days < 0 ? 0xFFE11D48 : 0xFF7C3AED);
            v.setOnClickFillInIntent(R.id.item_root, new Intent());
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int pos) { return pos; }
        @Override public boolean hasStableIds() { return false; }
    }
}
