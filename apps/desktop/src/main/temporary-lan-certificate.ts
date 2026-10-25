import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { connect } from "node:tls";
import { isIP } from "node:net";

const der = (tag: number, bytes: Buffer): Buffer => {
  const length =
    bytes.length < 128
      ? Buffer.from([bytes.length])
      : (() => {
          const values: number[] = [];
          for (let n = bytes.length; n; n >>>= 8) values.unshift(n & 255);
          return Buffer.from([128 | values.length, ...values]);
        })();
  return Buffer.concat([Buffer.from([tag]), length, bytes]);
};
const sequence = (...bytes: Buffer[]) => der(0x30, Buffer.concat(bytes));
const oid = (bytes: number[]) => der(6, Buffer.from(bytes));
const time = (date: Date) =>
  der(
    0x17,
    Buffer.from(
      date
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(2, 14) + "Z",
    ),
  );
const pem = (label: string, bytes: Buffer) =>
  `-----BEGIN ${label}-----\n${bytes
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END ${label}-----\n`;

/** Ephemeral TLS key, separate from the persistent device proof key. Never written to disk. */
export function createLanCertificate(now = Date.now()): {
  cert: string;
  key: string;
  sha256: string;
} {
  // Electron's BoringSSL cannot negotiate the previous Ed25519 TLS certificate.
  // Device proofs keep Ed25519; only this ephemeral TLS key uses P-256/SHA-256.
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const algorithm = sequence(oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]));
  const name = sequence(
    der(0x31, sequence(oid([0x55, 4, 3]), der(0x0c, Buffer.from("shanghao.local")))),
  );
  const serial = randomBytes(16);
  // DER INTEGER must be positive and minimally encoded; a random leading zero was invalid.
  serial[0] = serial[0]! & 0x7f || 1;
  const subjectAlternativeName = sequence(
    oid([0x55, 0x1d, 0x11]),
    der(4, sequence(der(0x82, Buffer.from("shanghao.local")))),
  );
  const tbs = sequence(
    der(0xa0, der(2, Buffer.from([2]))),
    der(2, serial),
    algorithm,
    name,
    sequence(time(new Date(now - 300_000)), time(new Date(now + 86_400_000))),
    name,
    pair.publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, sequence(subjectAlternativeName)),
  );
  const certificate = sequence(
    tbs,
    algorithm,
    der(3, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, pair.privateKey)])),
  );
  const parsed = new X509Certificate(certificate);
  if (!parsed.verify(pair.publicKey) || parsed.checkHost("shanghao.local") !== "shanghao.local")
    throw Error("temporary_lan_certificate_invalid");
  return {
    cert: pem("CERTIFICATE", certificate),
    key: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    sha256: createHash("sha256").update(certificate).digest("hex"),
  };
}

/** Fetch only the public certificate first; no WebSocket, proof, ticket or HTTP data is sent. */
export function readPinnedLanCertificate(
  endpoint: string,
  fingerprint: string,
  signal?: AbortSignal,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return Promise.reject(Error("temporary_lan_endpoint_invalid"));
  }
  if (
    url.protocol !== "wss:" ||
    !isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    url.username ||
    url.password ||
    !/^[a-f0-9]{64}$/.test(fingerprint)
  )
    return Promise.reject(Error("temporary_lan_endpoint_invalid"));
  if (signal?.aborted) return Promise.reject(Error("temporary_discovery_cancelled"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, cert?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket?.destroy();
      if (error) reject(error);
      else resolve(cert!);
    };
    const abort = () => finish(Error("temporary_discovery_cancelled"));
    const timer = setTimeout(() => finish(Error("temporary_lan_tls_timeout")), 2000);
    const socket = connect({
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 443),
      servername: "shanghao.local",
      rejectUnauthorized: false,
    });
    socket.once("secureConnect", () => {
      const raw = socket.getPeerCertificate().raw;
      if (!raw || createHash("sha256").update(raw).digest("hex") !== fingerprint)
        finish(Error("temporary_lan_tls_pin_mismatch"));
      else finish(undefined, pem("CERTIFICATE", raw));
    });
    socket.once("error", () => finish(Error("temporary_lan_tls_failed")));
    socket.once("close", () => {
      if (!settled) finish(Error("temporary_lan_tls_closed"));
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}
