import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  recoverProviderPlaintext,
  migrateRecoveredProvider,
  readBoundedProviderFile,
  recoverAndMigrateProvider,
} from "../src/main/provider-encryption-recovery";

test("concurrent recovery coalesces OS work and oversized credentials are rejected before reading", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "shanghao-provider-coalesce-"));
  const key = randomBytes(32),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    Buffer.from("v10"),
    nonce,
    cipher.update('{"apiKey":"synthetic"}'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const profile = path.join(root, "shanghao");
  mkdirSync(path.join(profile, "ai"), { recursive: true });
  const file = path.join(profile, "ai/provider.enc");
  writeFileSync(file, encrypted);
  writeFileSync(
    path.join(profile, "Local State"),
    JSON.stringify({
      os_crypt: {
        encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from("synthetic")]).toString(
          "base64",
        ),
      },
    }),
  );
  let calls = 0;
  const unwrap = async () => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return Buffer.from(key);
  };
  try {
    const first = recoverAndMigrateProvider(
      file,
      encrypted,
      root,
      () => {},
      () => Buffer.from("new-encrypted"),
      unwrap,
    );
    const second = recoverAndMigrateProvider(
      file,
      encrypted,
      root,
      () => {},
      () => Buffer.from("wrong-second-writer"),
      unwrap,
    );
    assert.equal(first, second);
    await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(readFileSync(file, "utf8"), "new-encrypted");
    writeFileSync(file, Buffer.alloc(65537));
    await assert.rejects(readBoundedProviderFile(file), /too_large/);
  } finally {
    key.fill(0);
    rmSync(root, { recursive: true, force: true });
  }
});

test("historical profile recovery authenticates the exact ciphertext and never searches other profiles", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "shanghao-provider-recovery-"));
  const key = randomBytes(32),
    nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    Buffer.from("v10"),
    nonce,
    cipher.update('{"model":"synthetic"}'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  try {
    for (const profile of ["shanghao", "shanghao-desktop", "unrelated"]) {
      mkdirSync(path.join(root, profile));
      writeFileSync(
        path.join(root, profile, "Local State"),
        JSON.stringify({
          os_crypt: {
            encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from(profile)]).toString(
              "base64",
            ),
          },
        }),
      );
    }
    const visited: string[] = [];
    const unwrap = (input: Buffer) => {
      visited.push(input.toString());
      return Buffer.from(input.toString() === "shanghao-desktop" ? key : Buffer.alloc(32));
    };
    assert.equal(await recoverProviderPlaintext(encrypted, root, unwrap), '{"model":"synthetic"}');
    assert.deepEqual(visited, ["shanghao", "shanghao-desktop"]);
    encrypted[encrypted.length - 1]! ^= 1;
    assert.equal(await recoverProviderPlaintext(encrypted, root, unwrap), undefined);
    assert.ok(!visited.includes("unrelated"));
  } finally {
    key.fill(0);
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration validates first, keeps encrypted backup, and refuses a changed owner", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shanghao-provider-migrate-"));
  const file = path.join(root, "provider.enc"),
    original = Buffer.from("old-encrypted");
  const validate = (value: unknown) => {
    if (!(value as { apiKey?: string })?.apiKey) throw Error("invalid");
  };
  try {
    writeFileSync(file, original);
    assert.throws(
      () => migrateRecoveredProvider(file, original, "{}", validate, () => Buffer.from("new")),
      /invalid/,
    );
    assert.deepEqual(readdirSync(root), ["provider.enc"]);
    assert.throws(
      () =>
        migrateRecoveredProvider(file, original, '{"apiKey":"synthetic"}', validate, () => {
          writeFileSync(file, "new-owner");
          return Buffer.from("new");
        }),
      /owner_changed/,
    );
    assert.equal(readFileSync(file, "utf8"), "new-owner");
    writeFileSync(file, original);
    migrateRecoveredProvider(file, original, '{"apiKey":"synthetic"}', validate, () =>
      Buffer.from("new-encrypted"),
    );
    assert.equal(readFileSync(file, "utf8"), "new-encrypted");
    const backup = readdirSync(root).find((name) => name.endsWith(".bak"))!;
    assert.deepEqual(readFileSync(path.join(root, backup)), original);
    assert.equal(readdirSync(root).filter((name) => name.endsWith(".tmp")).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
