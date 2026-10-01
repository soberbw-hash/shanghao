/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Test processes must never reuse an installed client's profile or session cache. */
exports.configureIsolatedProfile = (app, label) => {
  if (!/^[a-z-]{1,32}$/.test(label)) throw new Error("invalid_test_profile_label");
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, `shanghao-${label}-profile-`));
  const sessionRoot = path.join(root, "session");
  fs.mkdirSync(sessionRoot);
  app.setPath("userData", root);
  app.setPath("sessionData", sessionRoot);
  app.once("quit", () => {
    try {
      // Only the exact freshly created sibling of TEMP may be recursively removed.
      if (fs.lstatSync(root).isSymbolicLink()) return;
      const resolved = fs.realpathSync(root);
      if (resolved !== root || path.dirname(resolved) !== tempRoot) return;
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* A locked test cache may remain; no retry against another directory. */
    }
  });
  return root;
};
/* global require, exports */
