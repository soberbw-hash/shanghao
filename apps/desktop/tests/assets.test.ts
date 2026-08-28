import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");

const listFilesRecursively = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const entryPath = path.join(directory, entry);
    return statSync(entryPath).isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });

test("desktop branding assets exist for app, tray, and github", () => {
  const files = [
    path.join(root, "apps/desktop/build/icon-master.png"),
    path.join(root, "apps/desktop/build/shanghao-icon-xl.ico"),
    path.join(root, "apps/desktop/build/shanghao-shortcut-xl.ico"),
    path.join(root, "apps/desktop/build/shanghao-icon-v3.ico"),
    path.join(root, "apps/desktop/build/shanghao-shortcut-v3.ico"),
    path.join(root, "apps/desktop/build/installer.nsh"),
    path.join(root, "apps/desktop/build/logo-ui.svg"),
    path.join(root, "apps/desktop/build/tray-dark.png"),
    path.join(root, "apps/desktop/build/tray-light.png"),
    path.join(root, "apps/desktop/src/renderer/src/assets/brand-mark.svg"),
    path.join(root, "docs/branding/github-avatar.png"),
  ];

  files.forEach((filePath) => {
    assert.equal(existsSync(filePath), true, `missing asset: ${filePath}`);
  });

  const windowSource = readFileSync(path.join(root, "apps/desktop/src/main/window.ts"), "utf8");
  assert.equal(
    windowSource.includes(
      'getBuildAssetPath(app.isPackaged ? "shanghao-icon-v3.ico" : "icon.png")',
    ),
    true,
  );
  assert.equal(windowSource.includes("nativeImage.createFromPath(iconPath)"), true);
  assert.equal(windowSource.includes("window.setIcon(windowIcon)"), true);
});

test("brand mark stays clean and consistent across renderer and desktop icon sources", () => {
  const rendererMark = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/assets/brand-mark.svg"),
    "utf8",
  );
  const buildMarks = [
    readFileSync(path.join(root, "apps/desktop/build/icon.svg"), "utf8"),
    readFileSync(path.join(root, "apps/desktop/build/logo-ui.svg"), "utf8"),
  ];

  for (const source of [rendererMark, ...buildMarks]) {
    assert.doesNotMatch(source, /feDropShadow|filter(?:\s+id|\s*=)/i);
  }
  assert.match(rendererMark, /viewBox="0 0 128 128"/);
  assert.match(rendererMark, /stroke-width="8"/);

  const brandComponent = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/components/brand/BrandMark.tsx"),
    "utf8",
  );
  const accountPage = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/pages/AccountPage.tsx"),
    "utf8",
  );
  const accountStyles = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/styles/parts/150-account.css"),
    "utf8",
  );
  const visualStyles = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/styles/parts/140-visual-experience.css"),
    "utf8",
  );

  assert.match(brandComponent, /assets\/brand-mark\.svg/);
  assert.match(brandComponent, /size-\[46px\]/);
  assert.match(accountPage, /<BrandMark size="account" className="account-brand-mark" \/>/);
  assert.doesNotMatch(accountPage, /<Headphones/);
  const accountMarkRule = accountStyles.match(/\.account-brand-mark\s*\{([^}]*)\}/)?.[1] ?? "";
  const aboutMarkRule = visualStyles.match(/\.about-product-mark\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(accountMarkRule, /box-shadow|background:/);
  assert.doesNotMatch(aboutMarkRule, /drop-shadow/);
});

test("desktop release configuration publishes automatic update metadata", () => {
  const builder = readFileSync(path.join(root, "apps/desktop/electron-builder.yml"), "utf8");
  const workflow = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");

  assert.equal(builder.includes("provider: github"), true);
  assert.equal(builder.includes("generateUpdatesFilesForAllChannels: true"), true);
  assert.equal(workflow.includes("latest*.yml"), true);
  assert.equal(workflow.includes("*.blockmap"), true);
  assert.equal(workflow.includes("pnpm test:five-peer-audio"), true);
});

test("room scene and feedback sound assets are bundled", () => {
  assert.equal(
    existsSync(
      path.join(root, "apps/desktop/src/renderer/src/assets/scenes/workstation-chibi.webp"),
    ),
    true,
    "missing premium workstation asset",
  );
  assert.equal(
    existsSync(path.join(root, "apps/desktop/src/renderer/src/assets/scenes/chair-chibi.webp")),
    true,
    "missing chibi chair asset",
  );

  for (const avatar of ["fox", "cat", "duck", "panda", "corgi"]) {
    assert.equal(
      existsSync(
        path.join(root, `apps/desktop/src/renderer/src/assets/avatars/${avatar}-scene.png`),
      ),
      true,
    );
    assert.equal(
      existsSync(
        path.join(root, `apps/desktop/src/renderer/src/assets/avatars/motion/${avatar}-motion.png`),
      ),
      true,
      `missing motion spritesheet: ${avatar}`,
    );
    assert.equal(
      existsSync(
        path.join(root, `apps/desktop/src/renderer/src/assets/avatars/rear/${avatar}-rear.png`),
      ),
      true,
      `missing rear workstation avatar: ${avatar}`,
    );
    for (const part of ["tail", "body", "feet", "head"]) {
      assert.equal(
        existsSync(
          path.join(
            root,
            `apps/desktop/src/renderer/src/assets/avatars/layers/${avatar}-${part}.png`,
          ),
        ),
        true,
        `missing layered avatar part: ${avatar}-${part}`,
      );
    }
  }

  for (const sound of [
    "button-click",
    "enter-room",
    "leave-room",
    "knock-bell",
    "popup-open",
    "copy-success",
    "device-switch",
    "send-message",
    "receive-message",
    "connection-restored",
    "connection-failed",
    "mic-error",
    "record-start",
    "record-stop",
    "speaker-muted",
    "speaker-unmuted",
    "member-join",
    "member-leave",
  ]) {
    assert.equal(
      existsSync(path.join(root, `apps/desktop/src/renderer/src/assets/sounds/${sound}.wav`)),
      true,
      `missing sound: ${sound}`,
    );
  }

  const buttonClick = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/assets/sounds/button-click.wav"),
  );
  const sampleRate = buttonClick.readUInt32LE(24);
  const dataLength = buttonClick.readUInt32LE(40);
  const duration = dataLength / (sampleRate * 2);
  assert.equal(sampleRate, 48_000);
  assert.equal(duration >= 0.06 && duration <= 0.09, true, "routine click must stay brief");

  for (const animalCall of [
    "cat-meow.wav",
    "duck-quack.wav",
    "panda-bear-growl.wav",
    "corgi-bark.wav",
    "fox-call.wav",
    "quick-reply-chirp.wav",
    "quick-reply-shanghao.wav",
  ]) {
    assert.equal(
      existsSync(
        path.join(root, `apps/desktop/src/renderer/src/assets/sounds/animals/${animalCall}`),
      ),
      true,
      `missing animal call: ${animalCall}`,
    );
  }
});

test("quick-message voice and music packs keep one compact AAC copy", () => {
  const sourceDirectory = path.join(root, "apps/desktop/resources/quick-messages");
  const rendererDuplicate = path.join(
    root,
    "apps/desktop/src/renderer/src/assets/sounds/quick-messages",
  );
  const files = listFilesRecursively(sourceDirectory);
  const totalBytes = files.reduce((sum, filePath) => sum + statSync(filePath).size, 0);

  assert.equal(files.length, 47);
  assert.equal(
    files.every((filePath) => path.extname(filePath).toLowerCase() === ".aac"),
    true,
  );
  for (const filePath of files) {
    const header = readFileSync(filePath).subarray(0, 2);
    assert.equal(header[0], 0xff, `not an ADTS AAC file: ${filePath}`);
    assert.equal((header[1] ?? 0) & 0xf0, 0xf0, `not an ADTS AAC file: ${filePath}`);
  }
  assert.equal(totalBytes < 9_000_000, true, "quick-message packs should remain compact");
  assert.equal(existsSync(rendererDuplicate), false, "renderer must not bundle a duplicate pack");

  const urlSource = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/features/audio/quickMessageAssets.ts"),
    "utf8",
  );
  assert.equal(urlSource.includes("shanghao-quick-message://audio/"), true);
  assert.doesNotMatch(urlSource, /\.(?:mp3|wav)\b/i);
});
