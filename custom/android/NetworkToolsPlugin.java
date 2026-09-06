package xyz.chatboxapp.chatbox;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.IDN;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Provider;
import java.security.PublicKey;
import java.security.Security;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import net.schmizz.sshj.SSHClient;
import net.schmizz.sshj.DefaultConfig;
import net.schmizz.sshj.common.Buffer;
import net.schmizz.sshj.common.Factory;
import net.schmizz.sshj.common.SecurityUtils;
import net.schmizz.sshj.connection.channel.direct.Session;
import net.schmizz.sshj.transport.kex.KeyExchange;
import net.schmizz.sshj.transport.verification.HostKeyVerifier;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import org.snmp4j.CommunityTarget;
import org.snmp4j.PDU;
import org.snmp4j.Snmp;
import org.snmp4j.Target;
import org.snmp4j.TransportMapping;
import org.snmp4j.UserTarget;
import org.snmp4j.event.ResponseEvent;
import org.snmp4j.mp.MPv3;
import org.snmp4j.mp.SnmpConstants;
import org.snmp4j.security.AuthHMAC192SHA256;
import org.snmp4j.security.PrivAES128;
import org.snmp4j.security.SecurityLevel;
import org.snmp4j.security.SecurityModels;
import org.snmp4j.security.SecurityProtocols;
import org.snmp4j.security.USM;
import org.snmp4j.security.UsmUser;
import org.snmp4j.smi.Address;
import org.snmp4j.smi.GenericAddress;
import org.snmp4j.smi.OID;
import org.snmp4j.smi.OctetString;
import org.snmp4j.smi.UdpAddress;
import org.snmp4j.smi.VariableBinding;
import org.snmp4j.transport.DefaultUdpTransportMapping;
import org.xbill.DNS.Lookup;
import org.xbill.DNS.SimpleResolver;
import org.xbill.DNS.Type;

/** Local, bounded Android network diagnostics. No MCP or remote tool service is used. */
@CapacitorPlugin(
    name = "NetworkTools",
    permissions = {@Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION})}
)
public class NetworkToolsPlugin extends Plugin {
    private static final int MAX_OUTPUT_BYTES = 128 * 1024;
    private static final String SSH_CRYPTO_PROVIDER = "ChatboxBC";
    private static final String KEY_ALIAS = "chatbox-network-tools-credentials";
    private static final String PREFS = "chatbox_network_tool_credentials";
    private static final Pattern PING_TIME = Pattern.compile("time[=<]([0-9.]+)\\s*ms");
    private static final Pattern HOST_PATTERN = Pattern.compile("^[A-Za-z0-9._:%-]{1,253}$");
    private final ExecutorService executor = Executors.newCachedThreadPool();

    private interface ToolWork { JSObject run() throws Exception; }

    private void async(PluginCall call, ToolWork work) {
        executor.execute(() -> {
            try { call.resolve(work.run()); }
            catch (Exception error) { call.reject(error.getMessage() == null ? error.toString() : error.getMessage(), error); }
        });
    }

    private static int intValue(JSONObject data, String key, int fallback, int min, int max) {
        return Math.max(min, Math.min(max, data.optInt(key, fallback)));
    }

    private static String requiredString(JSONObject data, String key) throws Exception {
        String value = data.optString(key, "").trim();
        if (value.isEmpty()) throw new Exception(key + " is required");
        return value;
    }

    private static String safeHost(String raw) throws Exception {
        String value = raw.trim();
        if (!HOST_PATTERN.matcher(value).matches()) throw new Exception("Invalid host");
        if (value.indexOf(':') < 0 && !value.matches("^[0-9.]+$")) value = IDN.toASCII(value);
        return value;
    }

    @PluginMethod public void getNetworkInfo(PluginCall call) { async(call, this::networkInfo); }

    private JSObject networkInfo() throws Exception {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = cm.getActiveNetwork();
        if (network == null) throw new Exception("No active network");
        LinkProperties lp = cm.getLinkProperties(network);
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        JSObject out = new JSObject();
        out.put("active", true);
        JSArray transports = new JSArray();
        if (caps != null) {
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transports.put("wifi");
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transports.put("cellular");
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transports.put("vpn");
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transports.put("ethernet");
            out.put("validated", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
            out.put("metered", !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
        }
        out.put("transports", transports);
        if (lp != null) {
            out.put("interface", lp.getInterfaceName());
            JSArray addresses = new JSArray();
            for (LinkAddress address : lp.getLinkAddresses()) {
                JSObject item = new JSObject(); item.put("address", address.getAddress().getHostAddress());
                item.put("prefixLength", address.getPrefixLength()); addresses.put(item);
            }
            out.put("addresses", addresses);
            JSArray dns = new JSArray(); for (InetAddress address : lp.getDnsServers()) dns.put(address.getHostAddress());
            out.put("dnsServers", dns);
            JSArray routes = new JSArray();
            for (RouteInfo route : lp.getRoutes()) {
                JSObject item = new JSObject(); item.put("destination", route.getDestination().toString());
                if (route.getGateway() != null) item.put("gateway", route.getGateway().getHostAddress());
                item.put("default", route.isDefaultRoute()); routes.put(item);
            }
            out.put("routes", routes);
        }
        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiInfo wi = wm.getConnectionInfo();
            if (wi != null) {
                JSObject wifi = new JSObject(); wifi.put("ssid", cleanSsid(wi.getSSID())); wifi.put("bssid", wi.getBSSID());
                wifi.put("rssi", wi.getRssi()); wifi.put("linkSpeedMbps", wi.getLinkSpeed()); wifi.put("frequencyMHz", wi.getFrequency());
                out.put("wifi", wifi);
            }
        } catch (SecurityException ignored) { out.put("wifiPermissionRequired", true); }
        return out;
    }

    @PluginMethod public void ping(PluginCall call) {
        async(call, () -> {
            JSONObject data = call.getData(); String host = safeHost(requiredString(data, "host"));
            int count = intValue(data, "count", 4, 1, 10); int timeoutMs = intValue(data, "timeoutMs", 3000, 100, 60000);
            List<String> command = new ArrayList<>(); command.add("/system/bin/ping");
            if (host.indexOf(':') >= 0) command.add("-6");
            command.addAll(Arrays.asList("-c", String.valueOf(count), "-W", String.valueOf(Math.max(1, timeoutMs / 1000)), host));
            long start = System.nanoTime(); Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            String output = readLimited(process.getInputStream());
            boolean finished = process.waitFor((long) timeoutMs * count + 2000, TimeUnit.MILLISECONDS);
            if (!finished) process.destroyForcibly();
            List<Double> times = new ArrayList<>(); Matcher matcher = PING_TIME.matcher(output);
            while (matcher.find()) times.add(Double.parseDouble(matcher.group(1)));
            JSObject out = latencyResult(times, count); out.put("host", host); out.put("method", "icmp-system-ping");
            out.put("exitCode", finished ? process.exitValue() : -1); out.put("durationMs", elapsedMs(start)); out.put("raw", output);
            return out;
        });
    }

    @PluginMethod public void tcpPing(PluginCall call) {
        async(call, () -> {
            JSONObject data = call.getData(); String host = safeHost(requiredString(data, "host"));
            int port = intValue(data, "port", 0, 1, 65535); int count = intValue(data, "count", 4, 1, 10);
            int timeout = intValue(data, "timeoutMs", 3000, 100, 60000); List<Double> times = new ArrayList<>();
            List<String> errors = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                long start = System.nanoTime();
                try (Socket socket = new Socket()) { socket.connect(new InetSocketAddress(host, port), timeout); times.add(elapsedMs(start)); }
                catch (Exception error) { errors.add(error.getClass().getSimpleName() + ": " + error.getMessage()); }
            }
            JSObject out = latencyResult(times, count); out.put("host", host); out.put("port", port); out.put("method", "tcp-connect");
            JSArray errorArray = new JSArray(); for (String error : errors) errorArray.put(error);
            out.put("errors", errorArray); return out;
        });
    }

    private static JSObject latencyResult(List<Double> times, int sent) {
        JSObject out = new JSObject(); out.put("sent", sent); out.put("received", times.size());
        out.put("packetLossPercent", sent == 0 ? 100 : (sent - times.size()) * 100.0 / sent);
        if (!times.isEmpty()) {
            double min = Collections.min(times), max = Collections.max(times), sum = 0; for (double value : times) sum += value;
            double avg = sum / times.size(), variance = 0; for (double value : times) variance += Math.pow(value - avg, 2);
            out.put("minMs", round(min)); out.put("avgMs", round(avg)); out.put("maxMs", round(max));
            out.put("jitterMs", round(Math.sqrt(variance / times.size())));
        }
        return out;
    }

    @PluginMethod public void dnsLookup(PluginCall call) {
        async(call, () -> {
            JSONObject data = call.getData(); String name = requiredString(data, "name");
            String typeName = data.optString("type", "A").toUpperCase(Locale.ROOT); int type = Type.value(typeName);
            if (type < 0) throw new Exception("Unsupported DNS type: " + typeName);
            Lookup lookup = new Lookup(name, type); String server = data.optString("server", "").trim();
            if (!server.isEmpty()) {
                SimpleResolver resolver = new SimpleResolver(safeHost(server)); resolver.setTCP(data.optBoolean("tcp", false));
                resolver.setTimeout(Duration.ofMillis(intValue(data, "timeoutMs", 5000, 100, 60000))); lookup.setResolver(resolver);
            }
            long start = System.nanoTime(); org.xbill.DNS.Record[] records = lookup.run(); JSArray values = new JSArray();
            if (records != null) for (org.xbill.DNS.Record record : records) values.put(record.rdataToString());
            JSObject out = new JSObject(); out.put("name", name); out.put("type", typeName); out.put("records", values);
            out.put("result", lookup.getErrorString()); out.put("elapsedMs", elapsedMs(start)); if (!server.isEmpty()) out.put("server", server);
            return out;
        });
    }

    @PluginMethod public void httpProbe(PluginCall call) {
        async(call, () -> {
            JSONObject data = call.getData(); URL url = new URL(requiredString(data, "url"));
            if (!"http".equals(url.getProtocol()) && !"https".equals(url.getProtocol())) throw new Exception("Only HTTP and HTTPS are supported");
            int timeout = intValue(data, "timeoutMs", 10000, 100, 60000); String host = url.getHost();
            int port = url.getPort() > 0 ? url.getPort() : ("https".equals(url.getProtocol()) ? 443 : 80);
            long dnsStart = System.nanoTime(); InetAddress[] addresses = InetAddress.getAllByName(host); double dnsMs = elapsedMs(dnsStart);
            long tcpStart = System.nanoTime(); try (Socket socket = new Socket()) { socket.connect(new InetSocketAddress(addresses[0], port), timeout); }
            double tcpMs = elapsedMs(tcpStart); JSObject tls = null;
            if ("https".equals(url.getProtocol())) {
                long tlsStart = System.nanoTime();
                try (SSLSocket socket = (SSLSocket) SSLSocketFactory.getDefault().createSocket()) {
                    socket.connect(new InetSocketAddress(host, port), timeout); socket.setSoTimeout(timeout); socket.startHandshake();
                    tls = new JSObject(); tls.put("protocol", socket.getSession().getProtocol()); tls.put("cipher", socket.getSession().getCipherSuite());
                    Certificate[] certs = socket.getSession().getPeerCertificates();
                    if (certs.length > 0 && certs[0] instanceof X509Certificate) {
                        X509Certificate cert = (X509Certificate) certs[0]; tls.put("subject", cert.getSubjectX500Principal().getName());
                        tls.put("issuer", cert.getIssuerX500Principal().getName()); tls.put("notBefore", cert.getNotBefore().toInstant().toString());
                        tls.put("notAfter", cert.getNotAfter().toInstant().toString());
                    }
                }
                tls.put("handshakeMs", elapsedMs(tlsStart));
            }
            long requestStart = System.nanoTime(); HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(timeout); connection.setReadTimeout(timeout); connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod(data.optString("method", "HEAD")); connection.setRequestProperty("User-Agent", "Chatbox-NetworkTools/1.0");
            int status = connection.getResponseCode(); double firstByteMs = elapsedMs(requestStart); JSObject headers = new JSObject();
            for (java.util.Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) if (entry.getKey() != null) headers.put(entry.getKey(), String.join(", ", entry.getValue()));
            JSObject out = new JSObject(); out.put("url", url.toString()); out.put("finalUrl", connection.getURL().toString()); out.put("status", status);
            out.put("dnsMs", round(dnsMs)); out.put("tcpConnectMs", round(tcpMs)); out.put("firstByteMs", round(firstByteMs));
            JSArray ips = new JSArray(); for (InetAddress address : addresses) ips.put(address.getHostAddress()); out.put("addresses", ips);
            out.put("headers", headers); if (tls != null) out.put("tls", tls); connection.disconnect(); return out;
        });
    }

    @PluginMethod public void mdnsDiscover(PluginCall call) {
        async(call, () -> {
            String requested = call.getData().optString("serviceType", "_http._tcp.");
            List<String> types = requested.trim().isEmpty()
                ? Arrays.asList("_http._tcp.", "_https._tcp.", "_ssh._tcp.", "_ipp._tcp.", "_printer._tcp.")
                : Collections.singletonList(requested.endsWith(".") ? requested : requested + ".");
            int timeout = intValue(call.getData(), "timeoutMs", 5000, 500, 30000); NsdManager manager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
            WifiManager wifiManager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock multicastLock = wifiManager.createMulticastLock("ChatboxNetworkToolsMdns");
            multicastLock.setReferenceCounted(false); multicastLock.acquire();
            List<NsdServiceInfo> found = Collections.synchronizedList(new ArrayList<>()); List<NsdManager.DiscoveryListener> listeners = new ArrayList<>();
            for (String type : types) {
                NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
                    public void onDiscoveryStarted(String s) {} public void onDiscoveryStopped(String s) {}
                    public void onStartDiscoveryFailed(String s, int c) {} public void onStopDiscoveryFailed(String s, int c) {}
                    public void onServiceLost(NsdServiceInfo i) {}
                    public void onServiceFound(NsdServiceInfo info) { found.add(info); }
                };
                listeners.add(listener); manager.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener);
            }
            Thread.sleep(timeout); for (NsdManager.DiscoveryListener listener : listeners) try { manager.stopServiceDiscovery(listener); } catch (Exception ignored) {}
            JSArray services = new JSArray(); Set<String> seen = new LinkedHashSet<>();
            synchronized (found) {
                for (NsdServiceInfo info : found) {
                    String key = info.getServiceName() + "|" + info.getServiceType(); if (!seen.add(key)) continue;
                    JSObject item = new JSObject(); item.put("name", info.getServiceName()); item.put("type", info.getServiceType());
                    CountDownLatch resolved = new CountDownLatch(1);
                    try {
                        manager.resolveService(info, new NsdManager.ResolveListener() {
                            public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) { item.put("resolveError", errorCode); resolved.countDown(); }
                            public void onServiceResolved(NsdServiceInfo serviceInfo) {
                                item.put("port", serviceInfo.getPort());
                                if (serviceInfo.getHost() != null) item.put("address", serviceInfo.getHost().getHostAddress());
                                item.put("attributes", serviceInfo.getAttributes().toString()); resolved.countDown();
                            }
                        });
                        resolved.await(1500, TimeUnit.MILLISECONDS);
                    } catch (Exception error) { item.put("resolveError", error.getMessage()); }
                    services.put(item); if (services.length() >= 50) break;
                }
            }
            if (multicastLock.isHeld()) multicastLock.release();
            JSObject out = new JSObject(); out.put("services", services); out.put("durationMs", timeout); return out;
        });
    }

    @PluginMethod public void wifiScan(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 23 && getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "wifiPermissionCallback"); return;
        }
        runWifiScan(call);
    }

    @PermissionCallback private void wifiPermissionCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) runWifiScan(call);
        else call.reject("Wi-Fi scan requires precise location permission and enabled Location services", "PERMISSION_DENIED");
    }

    private void runWifiScan(PluginCall call) {
        async(call, () -> {
            WifiManager manager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            boolean requested = call.getData().optBoolean("fresh", true) && manager.startScan(); if (requested) Thread.sleep(1800);
            List<ScanResult> results = manager.getScanResults(); results.sort(Comparator.comparingInt((ScanResult r) -> r.level).reversed());
            JSArray networks = new JSArray(); for (ScanResult result : results) {
                JSObject item = new JSObject(); item.put("ssid", result.SSID); item.put("bssid", result.BSSID); item.put("rssi", result.level);
                item.put("frequencyMHz", result.frequency); item.put("channel", wifiChannel(result.frequency)); item.put("capabilities", result.capabilities); networks.put(item);
            }
            JSObject out = new JSObject(); out.put("freshScanRequested", requested); out.put("cached", !requested); out.put("networks", networks); return out;
        });
    }

    @PluginMethod public void lanScan(PluginCall call) {
        async(call, () -> {
            JSONObject data = call.getData(); Ipv4Subnet active = activeIpv4Subnet(); String rawCidr = data.optString("cidr", "").trim();
            Ipv4Subnet subnet = rawCidr.isEmpty() ? active : Ipv4Subnet.parse(rawCidr);
            if (!subnet.contains(active.address)) throw new Exception("LAN scan CIDR must contain this phone's active IPv4 address");
            int maxHosts = intValue(data, "maxHosts", 256, 1, 1024); if (subnet.hostCount() > maxHosts) throw new Exception("CIDR exceeds configured host limit of " + maxHosts);
            int timeout = intValue(data, "timeoutMs", 350, 100, 3000); JSONArray rawPorts = data.optJSONArray("ports");
            List<Integer> ports = new ArrayList<>(); if (rawPorts != null) for (int i = 0; i < Math.min(16, rawPorts.length()); i++) ports.add(Math.max(1, Math.min(65535, rawPorts.optInt(i))));
            if (ports.isEmpty()) ports.addAll(Arrays.asList(22, 53, 80, 443, 445, 3389, 8080));
            ExecutorService pool = Executors.newFixedThreadPool(32); List<Future<JSObject>> futures = new ArrayList<>();
            for (long ip : subnet.hostAddresses()) { final String host = Ipv4Subnet.format(ip); final List<Integer> scanPorts = ports;
                futures.add(pool.submit(() -> scanHost(host, scanPorts, timeout))); }
            pool.shutdown(); JSArray hosts = new JSArray(); for (Future<JSObject> future : futures) { JSObject result = future.get(); if (result != null) hosts.put(result); }
            JSArray portArray = new JSArray(); for (int port : ports) portArray.put(port);
            JSObject out = new JSObject(); out.put("cidr", subnet.toString()); out.put("ports", portArray); out.put("hosts", hosts); out.put("method", "bounded-tcp-connect"); return out;
        });
    }

    private JSObject scanHost(String host, List<Integer> ports, int timeout) {
        JSArray open = new JSArray(); for (int port : ports) try (Socket socket = new Socket()) { socket.connect(new InetSocketAddress(host, port), timeout); open.put(port); } catch (Exception ignored) {}
        if (open.length() == 0) return null; JSObject item = new JSObject(); item.put("address", host); item.put("openPorts", open);
        try { item.put("hostname", InetAddress.getByName(host).getCanonicalHostName()); } catch (Exception ignored) {} return item;
    }

    @PluginMethod public void speedTest(PluginCall call) {
        async(call, () -> {
            JSONObject data = call.getData(); String downloadUrl = requiredString(data, "downloadUrl"), uploadUrl = requiredString(data, "uploadUrl");
            int bytes = intValue(data, "maxBytes", 5_000_000, 1_000_000, 500_000_000); List<Double> latency = new ArrayList<>();
            for (int i = 0; i < 3; i++) { long start = System.nanoTime(); HttpURLConnection c = (HttpURLConnection) new URL(downloadUrl + "?bytes=0").openConnection(); c.setRequestMethod("HEAD"); c.setConnectTimeout(10000); c.setReadTimeout(10000); c.getResponseCode(); latency.add(elapsedMs(start)); c.disconnect(); }
            String separator = downloadUrl.contains("?") ? "&" : "?"; HttpURLConnection down = (HttpURLConnection) new URL(downloadUrl + separator + "bytes=" + bytes).openConnection(); down.setConnectTimeout(15000); down.setReadTimeout(30000);
            long downStart = System.nanoTime(); int downloaded = drain(down.getInputStream(), bytes); double downSeconds = (System.nanoTime() - downStart) / 1_000_000_000.0; down.disconnect();
            HttpURLConnection up = (HttpURLConnection) new URL(uploadUrl).openConnection(); up.setDoOutput(true); up.setRequestMethod("POST"); up.setFixedLengthStreamingMode(bytes); up.setConnectTimeout(15000); up.setReadTimeout(30000); up.setRequestProperty("Content-Type", "application/octet-stream");
            byte[] buffer = new byte[64 * 1024]; long upStart = System.nanoTime(); try (OutputStream output = up.getOutputStream()) { int remaining = bytes; while (remaining > 0) { int n = Math.min(buffer.length, remaining); output.write(buffer, 0, n); remaining -= n; } }
            int uploadStatus = up.getResponseCode(); double upSeconds = (System.nanoTime() - upStart) / 1_000_000_000.0; up.disconnect();
            JSObject out = latencyResult(latency, latency.size()); out.put("latencyAvgMs", out.opt("avgMs")); out.put("downloadBytes", downloaded);
            out.put("downloadMbps", round(downloaded * 8.0 / downSeconds / 1_000_000.0)); out.put("uploadBytes", bytes); out.put("uploadMbps", round(bytes * 8.0 / upSeconds / 1_000_000.0)); out.put("uploadStatus", uploadStatus); return out;
        });
    }

    @PluginMethod public void saveCredential(PluginCall call) {
        async(call, () -> { String id = requiredString(call.getData(), "id"), payload = requiredString(call.getData(), "payload");
            preferences().edit().putString(id, encrypt(payload)).remove(sshHostKeyPreference(id)).apply(); JSObject out = new JSObject(); out.put("saved", true); return out; });
    }

    @PluginMethod public void deleteCredential(PluginCall call) {
        async(call, () -> { String id = requiredString(call.getData(), "id"); boolean existed = preferences().contains(id); preferences().edit().remove(id).remove(sshHostKeyPreference(id)).apply(); JSObject out = new JSObject(); out.put("deleted", existed); return out; });
    }

    @PluginMethod public void sshExec(PluginCall call) {
        async(call, () -> {
            JSONObject data = call.getData(); String credentialId = requiredString(data, "credentialId"); JSONObject credential = credential(credentialId);
            String host = safeHost(requiredString(data, "host")), username = requiredString(data, "username"), command = requiredString(data, "command");
            int port = intValue(data, "port", 22, 1, 65535), timeout = intValue(data, "timeoutMs", 15000, 500, 60000);
            String configured = data.optString("hostKeyFingerprint", "").trim();
            String saved = preferences().getString(sshHostKeyPreference(credentialId), "");
            String trusted = configured.isEmpty() ? saved : configured;
            boolean trustOnFirstUse = trusted.isEmpty(); final String[] observed = new String[1];
            try (SSHClient ssh = newAndroidCompatibleSshClient()) {
                ssh.setConnectTimeout(timeout); ssh.setTimeout(timeout); ssh.addHostKeyVerifier(new HostKeyVerifier() {
                    public boolean verify(String hostname, int remotePort, PublicKey key) {
                        observed[0] = fingerprint(key);
                        return trustOnFirstUse || fingerprintMatches(trusted, observed[0], legacyFingerprint(key));
                    }
                    public List<String> findExistingAlgorithms(String hostname, int remotePort) { return Collections.emptyList(); }
                });
                try { ssh.connect(host, port); } catch (Exception error) {
                    if (!trustOnFirstUse && observed[0] != null) throw new Exception("SSH host key mismatch. Trusted: " + trusted + "; observed: " + observed[0]);
                    throw error;
                }
                if (trustOnFirstUse && observed[0] != null) preferences().edit().putString(sshHostKeyPreference(credentialId), observed[0]).apply();
                String authType = credential.optString("authType", "password");
                if (!"password".equals(authType)) throw new Exception("This build currently supports SSH password profiles only");
                ssh.authPassword(username, requiredString(credential, "password"));
                try (Session session = ssh.startSession()) {
                    Session.Command remote = session.exec(command); remote.join(timeout, TimeUnit.MILLISECONDS); boolean finished = remote.getExitStatus() != null;
                    if (!finished) remote.close(); String stdout = readLimited(remote.getInputStream()), stderr = readLimited(remote.getErrorStream());
                    JSObject out = new JSObject(); out.put("profileId", data.optString("id")); out.put("host", host); out.put("command", command);
                    out.put("stdout", stdout); out.put("stderr", stderr); out.put("exitStatus", remote.getExitStatus()); out.put("timedOut", !finished); out.put("hostKeyFingerprint", observed[0]);
                    out.put("hostKeyTrust", trustOnFirstUse ? "trusted-on-first-use" : (configured.isEmpty() ? "saved" : "configured")); return out;
                }
            }
        });
    }

    @PluginMethod public void snmpGet(PluginCall call) { async(call, () -> snmp(call.getData(), false)); }
    @PluginMethod public void snmpWalk(PluginCall call) { async(call, () -> snmp(call.getData(), true)); }

    /** Android's stripped provider is also named BC, so SSHJ can select it instead of the
     * bundled modern implementation. Register a private provider name for SSHJ only. This
     * keeps Curve25519/Ed25519 available without replacing Android's process-wide BC entry.
     * If provider setup is rejected by a vendor ROM, fall back to portable non-X25519 KEX.
     */
    private static SSHClient newAndroidCompatibleSshClient() {
        DefaultConfig config = new DefaultConfig();
        if (!configureBundledSshProvider()) {
            List<Factory.Named<KeyExchange>> compatible = new ArrayList<>();
            for (Factory.Named<KeyExchange> factory : config.getKeyExchangeFactories()) {
                if (!factory.getName().toLowerCase(Locale.ROOT).contains("curve25519")) compatible.add(factory);
            }
            if (compatible.isEmpty()) throw new IllegalStateException("No Android-compatible SSH key exchange algorithms available");
            config.setKeyExchangeFactories(compatible);
        }
        return new SSHClient(config);
    }

    private static synchronized boolean configureBundledSshProvider() {
        try {
            if (Security.getProvider(SSH_CRYPTO_PROVIDER) == null) {
                BouncyCastleProvider bundled = new BouncyCastleProvider();
                Provider isolated = new Provider(SSH_CRYPTO_PROVIDER, bundled.getVersion(), "Chatbox bundled Bouncy Castle") {
                    private static final long serialVersionUID = 1L;
                };
                for (Map.Entry<Object, Object> entry : bundled.entrySet()) {
                    String key = String.valueOf(entry.getKey());
                    if (!key.startsWith("Provider.id ")) isolated.put(entry.getKey(), entry.getValue());
                }
                if (Security.addProvider(isolated) < 0 && Security.getProvider(SSH_CRYPTO_PROVIDER) == null) return false;
            }
            SecurityUtils.setRegisterBouncyCastle(false);
            SecurityUtils.setSecurityProvider(SSH_CRYPTO_PROVIDER);
            SecurityUtils.getKeyAgreement("X25519");
            SecurityUtils.getKeyPairGenerator("X25519");
            SecurityUtils.getSignature("Ed25519");
            SecurityUtils.getKeyAgreement("ECDH");
            SecurityUtils.getKeyAgreement("DH");
            SecurityUtils.getCipher("AES/GCM/NoPadding");
            return true;
        } catch (Exception error) {
            SecurityUtils.setSecurityProvider(null);
            SecurityUtils.setRegisterBouncyCastle(false);
            Security.removeProvider(SSH_CRYPTO_PROVIDER);
            return false;
        }
    }

    @SuppressWarnings({"rawtypes", "unchecked"}) private JSObject snmp(JSONObject data, boolean walk) throws Exception {
        JSONObject credential = credential(requiredString(data, "credentialId")); String host = safeHost(requiredString(data, "host"));
        int port = intValue(data, "port", 161, 1, 65535), timeout = intValue(data, "timeoutMs", 5000, 200, 60000), max = intValue(data, "maxResults", 50, 1, 200);
        OID root = new OID(requiredString(data, "oid")); TransportMapping<UdpAddress> transport = new DefaultUdpTransportMapping(); Snmp snmp = new Snmp(transport); transport.listen();
        try {
            Target target;
            if ("3".equals(data.optString("version", "3"))) {
                OctetString securityName = new OctetString(requiredString(credential, "securityName"));
                SecurityProtocols.getInstance().addDefaultProtocols();
                USM usm = new USM(SecurityProtocols.getInstance(), new OctetString(MPv3.createLocalEngineID()), 0); SecurityModels.getInstance().addSecurityModel(usm);
                snmp.getUSM().addUser(securityName, new UsmUser(securityName, AuthHMAC192SHA256.ID,
                    new OctetString(requiredString(credential, "authPassphrase")), PrivAES128.ID,
                    new OctetString(requiredString(credential, "privPassphrase"))));
                UserTarget user = new UserTarget(); user.setSecurityName(securityName); user.setSecurityLevel(SecurityLevel.AUTH_PRIV); user.setVersion(SnmpConstants.version3); target = user;
            } else {
                CommunityTarget community = new CommunityTarget(); community.setCommunity(new OctetString(requiredString(credential, "community"))); community.setVersion(SnmpConstants.version2c); target = community;
            }
            Address address = GenericAddress.parse("udp:" + host + "/" + port); target.setAddress(address); target.setRetries(1); target.setTimeout(timeout);
            JSArray bindings = new JSArray(); OID current = root;
            for (int i = 0; i < (walk ? max : 1); i++) {
                PDU pdu = new PDU(); pdu.setType(walk ? PDU.GETNEXT : PDU.GET); pdu.add(new VariableBinding(current)); ResponseEvent event = snmp.send(pdu, target);
                if (event == null || event.getResponse() == null) throw new Exception("SNMP request timed out"); PDU response = event.getResponse();
                if (response.getErrorStatus() != PDU.noError) throw new Exception("SNMP error: " + response.getErrorStatusText());
                VariableBinding vb = response.get(0); if (vb == null || (walk && !vb.getOid().startsWith(root))) break;
                JSObject item = new JSObject(); item.put("oid", vb.getOid().toDottedString()); item.put("syntax", vb.getVariable().getSyntaxString()); item.put("value", vb.toValueString()); bindings.put(item);
                if (!walk || vb.getOid().equals(current)) break; current = vb.getOid();
            }
            JSObject out = new JSObject(); out.put("host", host); out.put("rootOid", root.toDottedString()); out.put("bindings", bindings); out.put("walk", walk); return out;
        } finally { snmp.close(); }
    }

    private SharedPreferences preferences() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static String sshHostKeyPreference(String credentialId) { return "ssh_host_key:" + credentialId; }

    private JSONObject credential(String id) throws Exception {
        String encrypted = preferences().getString(id, null); if (encrypted == null) throw new Exception("Credential not found: " + id);
        return new JSONObject(decrypt(encrypted));
    }

    private SecretKey credentialKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    private String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, credentialKey());
        byte[] iv = cipher.getIV(), ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8)); ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(iv.length); out.write(iv); out.write(ciphertext); return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        byte[] packed = Base64.decode(value, Base64.NO_WRAP); int ivLength = packed[0] & 0xff; if (ivLength < 12 || packed.length <= ivLength + 1) throw new Exception("Invalid credential data");
        byte[] iv = Arrays.copyOfRange(packed, 1, 1 + ivLength), ciphertext = Arrays.copyOfRange(packed, 1 + ivLength, packed.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, credentialKey(), new GCMParameterSpec(128, iv)); return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    private Ipv4Subnet activeIpv4Subnet() throws Exception {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE); Network active = cm.getActiveNetwork(); LinkProperties lp = active == null ? null : cm.getLinkProperties(active);
        if (lp != null) for (LinkAddress address : lp.getLinkAddresses()) if (address.getAddress() instanceof Inet4Address) return new Ipv4Subnet(ipv4Long(address.getAddress()), address.getPrefixLength());
        throw new Exception("No active IPv4 subnet");
    }

    private static class Ipv4Subnet {
        final long address, network, broadcast; final int prefix;
        Ipv4Subnet(long address, int prefix) throws Exception { if (prefix < 16 || prefix > 32) throw new Exception("LAN scan prefix must be between /16 and /32"); this.address = address; this.prefix = prefix; long mask = prefix == 0 ? 0 : (0xffffffffL << (32 - prefix)) & 0xffffffffL; network = address & mask; broadcast = network | (~mask & 0xffffffffL); }
        static Ipv4Subnet parse(String cidr) throws Exception { String[] parts = cidr.split("/", -1); if (parts.length != 2) throw new Exception("Invalid IPv4 CIDR"); InetAddress ip = InetAddress.getByName(parts[0]); if (!(ip instanceof Inet4Address)) throw new Exception("LAN scan currently supports IPv4 only"); return new Ipv4Subnet(ipv4Long(ip), Integer.parseInt(parts[1])); }
        boolean contains(long value) { return value >= network && value <= broadcast; }
        long hostCount() { return prefix >= 31 ? broadcast - network + 1 : Math.max(0, broadcast - network - 1); }
        List<Long> hostAddresses() { List<Long> out = new ArrayList<>(); long first = prefix >= 31 ? network : network + 1, last = prefix >= 31 ? broadcast : broadcast - 1; for (long value = first; value <= last; value++) out.add(value); return out; }
        public String toString() { return format(network) + "/" + prefix; }
        static String format(long value) { return ((value >> 24) & 255) + "." + ((value >> 16) & 255) + "." + ((value >> 8) & 255) + "." + (value & 255); }
    }

    private static long ipv4Long(InetAddress address) { byte[] b = address.getAddress(); return ((b[0] & 255L) << 24) | ((b[1] & 255L) << 16) | ((b[2] & 255L) << 8) | (b[3] & 255L); }
    private static int drain(InputStream input, int limit) throws Exception { try (InputStream in = input) { byte[] buffer = new byte[64 * 1024]; int total = 0, read; while (total < limit && (read = in.read(buffer, 0, Math.min(buffer.length, limit - total))) != -1) total += read; return total; } }
    private static String readLimited(InputStream input) throws Exception { try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] buffer = new byte[8192]; int read; while ((read = in.read(buffer)) != -1) { int allowed = Math.min(read, MAX_OUTPUT_BYTES - out.size()); if (allowed > 0) out.write(buffer, 0, allowed); if (out.size() >= MAX_OUTPUT_BYTES) break; } return out.toString("UTF-8"); } }
    private static double elapsedMs(long start) { return (System.nanoTime() - start) / 1_000_000.0; }
    private static double round(double value) { return Math.round(value * 100.0) / 100.0; }
    private static String cleanSsid(String value) { return value == null ? null : value.replaceAll("^\"|\"$", ""); }
    private static int wifiChannel(int frequency) { if (frequency == 2484) return 14; if (frequency >= 2412 && frequency <= 2472) return (frequency - 2407) / 5; if (frequency >= 5000 && frequency <= 5900) return (frequency - 5000) / 5; if (frequency >= 5955 && frequency <= 7115) return (frequency - 5950) / 5; return 0; }
    private static String fingerprint(PublicKey key) {
        try {
            byte[] encoded = new Buffer.PlainBuffer().putPublicKey(key).getCompactData();
            String digest = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(encoded), Base64.NO_WRAP | Base64.NO_PADDING);
            return "SHA256:" + digest;
        } catch (Exception error) { return "unavailable"; }
    }

    private static String legacyFingerprint(PublicKey key) {
        try { return SecurityUtils.getFingerprint(key); } catch (Exception error) { return "unavailable"; }
    }

    private static boolean fingerprintMatches(String expected, String sha256, String legacyMd5) {
        if (expected.equals(sha256)) return true;
        String normalized = expected.regionMatches(true, 0, "MD5:", 0, 4) ? expected.substring(4) : expected;
        return normalized.equalsIgnoreCase(legacyMd5);
    }
}
