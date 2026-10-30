package com.cactuspos.client;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** No credentials, paths, query strings or executable schemes in a saved till origin. */
public final class ServerAddress {
    private ServerAddress() { }
    public static String normalize(String text) {
        String value = text.trim();
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            if ((!scheme.equals("http") && !scheme.equals("https")) || host == null || host.isEmpty()
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))
                    || uri.getPort() == 0 || uri.getPort() > 65535) throw new IllegalArgumentException();
            host = host.toLowerCase(Locale.ROOT);
            int port = uri.getPort();
            if ((scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443)) port = -1;
            return new URI(scheme, null, host, port, null, null, null).toASCIIString();
        } catch (URISyntaxException | NullPointerException error) { throw new IllegalArgumentException("Use an address such as cactus.local or 192.168.1.20:3000.", error); }
    }
    public static boolean sameOrigin(String candidate, String origin) {
        try {
            URI uri = new URI(candidate);
            return normalize(new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString()).equals(origin)
                && uri.getRawUserInfo() == null;
        } catch (Exception error) { return false; }
    }
    public static String screenPath(int screen) {
        String[] paths = { "/pos", "/kitchen", "/pickup", "/admin" };
        return paths[Math.max(0, Math.min(paths.length - 1, screen))];
    }
}
