package com.victorlanes.financas;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.victorlanes.financas.widget.WidgetBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
