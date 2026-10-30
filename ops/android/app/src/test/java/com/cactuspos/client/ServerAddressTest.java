package com.cactuspos.client;

import org.junit.Test;
import static org.junit.Assert.*;

public class ServerAddressTest {
    @Test public void normalizesLocalNameAndFallbacks() {
        assertEquals("http://cactus.local", ServerAddress.normalize(" cactus.local/ "));
        assertEquals("http://192.168.1.20:3000", ServerAddress.normalize("192.168.1.20:3000"));
        assertEquals("https://my-till.local", ServerAddress.normalize("https://MY-TILL.local:443/"));
        assertEquals("http://[fe80::1]:3000", ServerAddress.normalize("http://[fe80::1]:3000"));
    }
    @Test public void rejectsUnsafeOrAmbiguousOrigins() {
        for (String address : new String[] { "javascript:alert(1)", "file:///tmp/page", "http://user:pass@cactus.local", "http://cactus.local/pos", "http://cactus.local?token=x", "http://cactus.local#x", "http://cactus.local:0", "http://cactus.local:65536" }) {
            try { ServerAddress.normalize(address); fail(address); } catch (IllegalArgumentException expected) { }
        }
    }
    @Test public void restrictsEmbeddedNavigationToChosenOrigin() {
        assertTrue(ServerAddress.sameOrigin("http://cactus.local/pos?x=1", "http://cactus.local"));
        assertFalse(ServerAddress.sameOrigin("http://cactus.local.evil/pos", "http://cactus.local"));
        assertFalse(ServerAddress.sameOrigin("https://cactus.local/pos", "http://cactus.local"));
        assertFalse(ServerAddress.sameOrigin("http://user@cactus.local/pos", "http://cactus.local"));
    }
}
