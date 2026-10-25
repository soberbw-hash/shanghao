import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { createServer } from "node:https";
import { once } from "node:events";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import {
  createLanCertificate,
  readPinnedLanCertificate,
} from "../src/main/temporary-lan-certificate";
test("random ephemeral serials always produce minimally encoded positive DER integers", () => {
  for (let i = 0; i < 1024; i++) {
    const value = createLanCertificate(),
      certificate = new X509Certificate(value.cert);
    assert.equal(certificate.serialNumber.length, 32);
    assert.notEqual(certificate.serialNumber.slice(0, 2), "00");
  }
});
test("ephemeral LAN certificates are self-signed, pinned before credentials, and usable with normal TLS verification", async (t) => {
  const identity = createLanCertificate();
  const certificate = new X509Certificate(identity.cert);
  assert.equal(certificate.verify(certificate.publicKey), true);
  assert.equal(createHash("sha256").update(certificate.raw).digest("hex"), identity.sha256);
  const server = createServer(identity);
  const wss = new WebSocketServer({ server });
  t.after(async () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const endpoint = `wss://127.0.0.1:${port}/temporary`;
  const cert = await readPinnedLanCertificate(endpoint, identity.sha256);
  const socket = new WebSocket(endpoint, {
    ca: cert,
    servername: "shanghao.local",
    rejectUnauthorized: true,
  });
  await once(socket, "open");
  socket.terminate();
  await assert.rejects(readPinnedLanCertificate(endpoint, "0".repeat(64)), /pin_mismatch/);
  await assert.rejects(
    readPinnedLanCertificate("wss://public.example.test/temporary", identity.sha256),
    /endpoint_invalid/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    readPinnedLanCertificate(endpoint, identity.sha256, aborted.signal),
    /cancelled/,
  );
});
