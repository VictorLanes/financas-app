package com.victorlanes.financas.widget;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/** Lê o resumo que o app grava em "widget_data" (Capacitor Preferences). */
public class WidgetStore {
    public static class Item {
        public String title;
        public double amount;
        public String due; // AAAA-MM-DD
        public boolean incoming;
    }

    public static class Data {
        public boolean ok;
        public boolean hide;
        public double balance, income, expense;
        public String month = "";
        public final List<Item> items = new ArrayList<>();
    }

    private static final NumberFormat BRL = NumberFormat.getCurrencyInstance(new Locale("pt", "BR"));

    public static String money(double v, boolean hide) {
        if (hide) return "R$ •••••";
        return BRL.format(v).replace(' ', ' ');
    }

    public static Data load(Context c) {
        Data d = new Data();
        try {
            String s = c.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("widget_data", null);
            if (s == null) return d;
            JSONObject j = new JSONObject(s);
            d.ok = true;
            d.hide = j.optBoolean("hide");
            d.balance = j.optDouble("balance", 0);
            d.income = j.optDouble("income", 0);
            d.expense = j.optDouble("expense", 0);
            d.month = j.optString("month", "");
            JSONArray a = j.optJSONArray("items");
            if (a != null) for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Item it = new Item();
                it.title = o.optString("t");
                it.amount = o.optDouble("a", 0);
                it.due = o.optString("d");
                it.incoming = "in".equals(o.optString("dir"));
                d.items.add(it);
            }
        } catch (Exception e) {
            Log.e("FinWidget", "erro ao ler", e);
        }
        return d;
    }

    /** dias entre hoje e a data (negativo = vencido) */
    public static int daysUntil(String ymd) {
        try {
            String[] p = ymd.split("-");
            Calendar due = Calendar.getInstance();
            due.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 12, 0, 0);
            Calendar now = Calendar.getInstance();
            now.set(Calendar.HOUR_OF_DAY, 12);
            now.set(Calendar.MINUTE, 0);
            now.set(Calendar.SECOND, 0);
            return (int) Math.round((due.getTimeInMillis() - now.getTimeInMillis()) / 86400000.0);
        } catch (Exception e) {
            return 999;
        }
    }

    public static String dueLabel(String ymd) {
        int d = daysUntil(ymd);
        if (d < -1) return "venceu há " + (-d) + " dias";
        if (d == -1) return "venceu ontem";
        if (d == 0) return "vence hoje";
        if (d == 1) return "vence amanhã";
        if (d <= 7) return "em " + d + " dias";
        return ymd.substring(8, 10) + "/" + ymd.substring(5, 7);
    }
}
