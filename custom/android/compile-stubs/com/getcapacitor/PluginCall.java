package com.getcapacitor;
public class PluginCall {
  public String getString(String name) { return null; }
  public JSObject getData() { return null; }
  public void resolve(JSObject data) {}
  public void reject(String message) {}
  public void reject(String message, String code) {}
  public void reject(String message, Exception error) {}
}
