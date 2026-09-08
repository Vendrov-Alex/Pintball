package com.survivor.roblaksim;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // The game already fights pull-to-refresh at the JS/CSS layer
    // (overscroll-behavior, a non-passive touchmove guard on the joystick),
    // but Android's WebView has its own separate overscroll glow/bounce that
    // those don't reach — see docs/STORE_RELEASE.md §3.
    WebView webView = getBridge().getWebView();
    webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
  }
}
