package com.getcapacitor;
import android.content.Context;
import android.content.Intent;
public class Plugin {
  public Context getContext() { return null; }
  public void startActivityForResult(PluginCall call, Intent intent, String callbackName) {}
  protected void requestPermissionForAlias(String alias, PluginCall call, String callbackName) {}
  public PermissionState getPermissionState(String alias) { return PermissionState.DENIED; }
}
