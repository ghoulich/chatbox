package com.getcapacitor;
import org.json.JSONObject;
public class JSObject extends JSONObject {
  public JSObject put(String key, String value) { return this; }
  public JSObject put(String key, boolean value) { return this; }
  public JSObject put(String key, int value) { return this; }
  public JSObject put(String key, long value) { return this; }
  public JSObject put(String key, double value) { return this; }
  public JSObject put(String key, Object value) { return this; }
}
