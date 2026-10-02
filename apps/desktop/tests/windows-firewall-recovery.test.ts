import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RelayStatusSnapshot, WindowsIntegrationStatus } from "@private-voice/shared";
import {
  firewallRepairAttempt,
  WindowsFirewallRecovery,
} from "../src/main/windows-firewall-recovery";
import {
  networkHealth,
  networkPermissionHealth,
} from "../src/renderer/src/features/diagnostics/networkPermissionHealth";
import { observeWindowsIntegration } from "../src/renderer/src/features/diagnostics/observeWindowsIntegration";

type Status = WindowsIntegrationStatus["firewall"];
const status = (healthy = false): Status => ({
  supported: true,
  healthy,
  ruleCount: healthy ? 4 : 0,
  expectedRuleCount: 4,
  message: healthy ? "healthy" : "missing",
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
};
const fixture = () => {
  let readCount = 0,
    repairs = 0,
    attempted = false,
    now = 0;
  let current = status();
  const operation = deferred<Status>();
  const deps = {
    read: async () => {
      readCount++;
      return current;
    },
    repair: () => {
      repairs++;
      return operation.promise;
    },
    claim: async () => {
      if (attempted) return false;
      attempted = true;
      return true;
    },
    clear: async () => {
      attempted = false;
    },
    enabled: () => true,
    now: () => now,
  };
  const service = new WindowsFirewallRecovery(deps);
  return {
    service,
    operation,
    deps,
    counts: () => ({ readCount, repairs, attempted }),
    set: (next: Status) => {
      current = next;
    },
    advance: () => {
      now += 30_001;
    },
  };
};

test("missing rules automatically start one repair; inspections never wait for the authorization box", async () => {
  const f = fixture();
  const checks = await Promise.all(Array.from({ length: 20 }, () => f.service.inspect()));
  assert.ok(checks.every((value) => value.repairState === "repairing"));
  assert.deepEqual(f.counts(), { readCount: 1, repairs: 1, attempted: true });
  assert.equal((await f.service.inspect(true)).repairState, "repairing");
  const retries = Array.from({ length: 20 }, () => f.service.retry());
  f.operation.resolve(status(true));
  assert.ok((await Promise.all(retries)).every((value) => value.healthy));
  assert.equal((await f.service.inspect()).healthy, true);
  assert.equal(f.counts().repairs, 1);
  assert.equal(f.counts().attempted, false);
  await f.service.retry();
  assert.equal(f.counts().repairs, 1);
});

test("cancelled authorization persists across checks and restart; explicit retry coalesces", async () => {
  const f = fixture();
  await f.service.inspect();
  const waiting = f.service.retry();
  f.operation.reject(new Error("windows_uac_cancelled"));
  assert.equal((await waiting).repairState, "authorization_required");
  f.advance();
  assert.equal((await f.service.inspect()).repairState, "authorization_required");
  const next = new WindowsFirewallRecovery(f.deps);
  assert.equal((await next.inspect()).repairState, "failed");
  assert.equal(f.counts().repairs, 1);
  const completed = deferred<Status>();
  let retryCount = 0;
  const retrying = new WindowsFirewallRecovery({
    ...f.deps,
    repair: () => {
      retryCount++;
      return completed.promise;
    },
  });
  await retrying.inspect();
  const retries = Array.from({ length: 30 }, () => retrying.retry());
  await Promise.resolve();
  completed.resolve(status(true));
  assert.ok((await Promise.all(retries)).every((value) => value.healthy));
  assert.equal(retryCount, 1);
});

test("timeout, system failure and unsuccessful verification remain failures without repeated repair", async () => {
  for (const result of [
    new Error("windows_system_timeout"),
    new Error("windows_system_operation_failed"),
    status(),
  ]) {
    const f = fixture();
    await f.service.inspect();
    const waiting = f.service.retry();
    if (result instanceof Error) f.operation.reject(result);
    else f.operation.resolve(result);
    const outcome = await waiting;
    assert.equal(outcome.healthy, false);
    assert.equal(outcome.repairState, "failed");
    await f.service.inspect(true);
    assert.equal(f.counts().repairs, 1);
  }
});

test("inspection or attempt-store failure cannot elevate, and later successful inspection can recover", async () => {
  for (const dependency of ["read", "claim"] as const) {
    const f = fixture();
    const failing = new WindowsFirewallRecovery({
      ...f.deps,
      [dependency]: async () => {
        throw new Error("access denied");
      },
    });
    assert.equal((await failing.inspect()).repairState, "unavailable");
    assert.equal(f.counts().repairs, 0);
  }
  const f = fixture();
  let fail = true;
  const service = new WindowsFirewallRecovery({
    ...f.deps,
    read: async () => {
      if (fail) throw new Error("temporary failure");
      return status();
    },
  });
  await service.inspect();
  fail = false;
  f.advance();
  assert.equal((await service.inspect()).repairState, "repairing");
  f.operation.resolve(status(true));
  await service.retry();
});

test("healthy, unsupported and development sessions never auto repair; cached reads are bounded", async () => {
  const f = fixture();
  f.set(status(true));
  assert.equal((await f.service.inspect()).healthy, true);
  await f.service.inspect();
  assert.equal(f.counts().readCount, 1);
  f.advance();
  await f.service.inspect();
  assert.equal(f.counts().readCount, 2);
  f.set({ ...status(), supported: false });
  await f.service.inspect(true);
  assert.equal(f.counts().repairs, 0);
  const dev = new WindowsFirewallRecovery({ ...f.deps, enabled: () => false });
  f.set(status());
  await dev.inspect();
  assert.equal(f.counts().repairs, 0);
});

test("durable attempt is claimed once per executable even concurrently, cleared only when healthy", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-firewall-test-"));
  try {
    const a = firewallRepairAttempt(directory, "C:\\Apps\\ShangHao.exe");
    assert.equal(
      (await Promise.all(Array.from({ length: 20 }, a.claim))).filter(Boolean).length,
      1,
    );
    assert.equal(await firewallRepairAttempt(directory, "c:\\apps\\shanghao.exe").claim(), false);
    assert.equal(await firewallRepairAttempt(directory, "C:\\New\\ShangHao.exe").claim(), true);
    await a.clear();
    assert.equal(await a.claim(), true);
    await a.clear();
    await a.clear();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("UI distinguishes automatic progress, system consent, failure and latency advisories honestly", () => {
  assert.equal(networkPermissionHealth({ ...status(), repairState: "repairing" }).retry, undefined);
  assert.equal(networkPermissionHealth({ ...status(), repairState: "repairing" }).badge, "修复中");
  assert.equal(
    networkPermissionHealth({ ...status(), repairState: "authorization_required" }).badge,
    "待系统授权",
  );
  assert.equal(networkPermissionHealth({ ...status(), repairState: "failed" }).retry, true);
  assert.equal(
    networkPermissionHealth({ ...status(), repairState: "unavailable" }).retry,
    undefined,
  );
  assert.equal(networkPermissionHealth(status(true)).level, "正常");
  for (const latencyMs of [160, 299, 900]) {
    const finding = networkHealth({ isReachable: true, latencyMs } as RelayStatusSnapshot);
    assert.equal(finding.level, "需要看看");
    assert.match(finding.description, new RegExp(`${latencyMs} ms`));
  }
  assert.equal(
    networkHealth({ isReachable: false, latencyMs: 40 } as RelayStatusSnapshot).level,
    "未检测",
  );
  assert.equal(
    networkHealth({ isReachable: true, latencyMs: NaN } as RelayStatusSnapshot).level,
    "未检测",
  );
});

test("visible diagnostics follow repair completion automatically; hidden sections stop polling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = deferred<WindowsIntegrationStatus>();
  const second = deferred<WindowsIntegrationStatus>();
  let reads = 0,
    settled = 0;
  const updates: WindowsIntegrationStatus[] = [];
  const stop = observeWindowsIntegration(
    (value) => updates.push(value),
    () => settled++,
    () => assert.fail("unexpected error"),
    () => {
      reads++;
      return reads === 1 ? first.promise : second.promise;
    },
  );
  t.mock.timers.tick(100_000);
  assert.equal(reads, 1); // No overlap during a slow read.
  first.resolve({
    firewall: { ...status(), repairState: "repairing" },
  } as WindowsIntegrationStatus);
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(1_999);
  assert.equal(reads, 1);
  t.mock.timers.tick(1);
  assert.equal(reads, 2);
  second.resolve({ firewall: status(true) } as WindowsIntegrationStatus);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(updates[1]?.firewall.healthy, true);
  assert.equal(settled, 2);
  t.mock.timers.tick(29_999);
  assert.equal(reads, 2);
  stop();
  t.mock.timers.tick(100_000);
  assert.equal(reads, 2);
});

test("late replies after settings cleanup are ignored and failed reads back off", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred<WindowsIntegrationStatus>();
  const stop = observeWindowsIntegration(
    () => assert.fail("late reply"),
    () => assert.fail("late settle"),
    () => assert.fail("late error"),
    () => pending.promise,
  );
  stop();
  pending.resolve({ firewall: status(true) } as WindowsIntegrationStatus);
  await Promise.resolve();
  await Promise.resolve();
  let errors = 0,
    reads = 0;
  const retryStop = observeWindowsIntegration(
    () => {},
    () => {},
    () => errors++,
    async () => {
      reads++;
      throw new Error("read failed");
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors, 1);
  t.mock.timers.tick(29_999);
  assert.equal(reads, 1);
  t.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reads, 2);
  retryStop();
});
