import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.Provider;
import java.security.Security;
import java.security.Signature;
import java.util.Map;
import javax.crypto.KeyAgreement;
import net.schmizz.sshj.DefaultConfig;
import net.schmizz.sshj.common.Factory;
import net.schmizz.sshj.common.SecurityUtils;
import net.schmizz.sshj.transport.kex.KeyExchange;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

/** JVM smoke test for the isolated crypto provider used by NetworkToolsPlugin SSH. */
public final class SshProviderCompatibilityCheck {
    private static final String PROVIDER = "ChatboxBC";

    public static void main(String[] args) throws Exception {
        BouncyCastleProvider bundled = new BouncyCastleProvider();
        Provider isolated = new Provider(PROVIDER, bundled.getVersion(), "Chatbox bundled Bouncy Castle") {
            private static final long serialVersionUID = 1L;
        };
        for (Map.Entry<Object, Object> entry : bundled.entrySet()) {
            String key = String.valueOf(entry.getKey());
            if (!key.startsWith("Provider.id ")) isolated.put(entry.getKey(), entry.getValue());
        }
        Security.addProvider(isolated);
        SecurityUtils.setRegisterBouncyCastle(false);
        SecurityUtils.setSecurityProvider(PROVIDER);

        KeyPair alice = SecurityUtils.getKeyPairGenerator("X25519").generateKeyPair();
        KeyPair bob = SecurityUtils.getKeyPairGenerator("X25519").generateKeyPair();
        KeyAgreement aliceAgreement = SecurityUtils.getKeyAgreement("X25519");
        aliceAgreement.init(alice.getPrivate());
        aliceAgreement.doPhase(bob.getPublic(), true);
        KeyAgreement bobAgreement = SecurityUtils.getKeyAgreement("X25519");
        bobAgreement.init(bob.getPrivate());
        bobAgreement.doPhase(alice.getPublic(), true);
        if (!java.util.Arrays.equals(aliceAgreement.generateSecret(), bobAgreement.generateSecret())) {
            throw new AssertionError("X25519 shared secrets differ");
        }

        KeyPair ed25519 = SecurityUtils.getKeyPairGenerator("Ed25519").generateKeyPair();
        byte[] message = "chatbox-ssh-provider-check".getBytes(StandardCharsets.UTF_8);
        Signature signer = SecurityUtils.getSignature("Ed25519");
        signer.initSign(ed25519.getPrivate());
        signer.update(message);
        byte[] signature = signer.sign();
        Signature verifier = SecurityUtils.getSignature("Ed25519");
        verifier.initVerify(ed25519.getPublic());
        verifier.update(message);
        if (!verifier.verify(signature)) throw new AssertionError("Ed25519 signature verification failed");

        SecurityUtils.getKeyAgreement("ECDH");
        SecurityUtils.getKeyAgreement("DH");
        SecurityUtils.getCipher("AES/GCM/NoPadding");

        boolean curve25519Advertised = false;
        for (Factory.Named<KeyExchange> factory : new DefaultConfig().getKeyExchangeFactories()) {
            if (factory.getName().contains("curve25519")) curve25519Advertised = true;
        }
        if (!curve25519Advertised) throw new AssertionError("SSHJ Curve25519 factories are missing");
        System.out.println("SSH_PROVIDER_COMPATIBILITY_OK");
    }
}
