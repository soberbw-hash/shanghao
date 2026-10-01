import assert from "node:assert/strict";
import test from "node:test";
import { compareArchitectureBudgets } from "../../../scripts/check-architecture-ratchet.mjs";

test("architecture ratchet rejects raising or silently deleting an existing ceiling", () => {
  const file = "apps/desktop/src/main/core.ts";
  assert.equal(compareArchitectureBudgets({ [file]: 100 }, { [file]: 101 }).length, 1);
  assert.equal(compareArchitectureBudgets({ [file]: 100 }, {}).length, 1);
  assert.equal(compareArchitectureBudgets({ [file]: 100 }, {}, () => false).length, 0);
  assert.deepEqual(
    compareArchitectureBudgets(
      { [file]: 100 },
      { [file]: 90, "packages/shared/src/helper.ts": 50 },
    ),
    [],
  );
  assert.equal(compareArchitectureBudgets({}, { "../outside.ts": 20 }).length, 1);
});
