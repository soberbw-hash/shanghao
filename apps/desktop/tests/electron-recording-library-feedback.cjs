/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "recording-feedback");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const deadline = setTimeout(() => app.exit(1), 45000);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (ok, reason) => {
  if (!ok) throw new Error(reason);
};
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 1080,
    useContentSize: true,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    window.webContents.on("console-message", (event) => {
      if (/error/i.test(event.message)) console.error(event.message);
    });
    const fixture = path
      .join(__dirname, "fixtures/recording-library-feedback.html")
      .replaceAll("\\", "/");
    await window.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5195"}/@fs/${fixture}`,
    );
    window.showInactive();
    await window.webContents.executeJavaScript(
      `(async()=>{for(let i=0;i<150;i++){if(document.querySelector('.recording-timeline')?.max==='800'&&document.querySelector('.voice-memory-summary'))return;await new Promise(r=>setTimeout(r,40));}throw Error('recording fixture did not mount')})()`,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.recording-detail-swap').getAnimations().forEach(animation=>animation.finish())",
    );
    await pause(100);
    const version = require("../package.json").version;
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("invalid_release_version");
    const assetDirectory =
      process.env.SHANGHAO_RELEASE_CAPTURE === "1"
        ? path.resolve(__dirname, "../../../docs/assets/releases", `v${version}`)
        : await fs.mkdtemp(path.join(os.tmpdir(), "shanghao-recording-feedback-images-"));
    await fs.mkdir(assetDirectory, { recursive: true });
    const geometry = [];
    for (const index of [0, 1, 2, 3]) {
      const frame = await window.webContents.executeJavaScript(`(async()=>{
        const dots=[...document.querySelectorAll('.recording-marker-dot')];dots[${index}].click();await new Promise(r=>setTimeout(r,70));
        const range=document.querySelector('.recording-timeline'), rect=range.getBoundingClientRect(), dot=dots[${index}].getBoundingClientRect();
        const cue=document.querySelector('.recording-marker-cue'), title=document.querySelector('.recording-player-title').getBoundingClientRect(), slot=document.querySelector('.recording-marker-cue-slot').getBoundingClientRect();
        const cueRect=cue.getBoundingClientRect();
        dots.forEach(dot=>dot.style.visibility='hidden');
        return {value:Number(range.value),max:Number(range.max),range:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},dot:{x:dot.x+dot.width/2,y:dot.y+dot.height/2},cueText:cue.textContent,cueBelowTitle:cueRect.top>=title.bottom,slotHeight:slot.height};
      })()`);
      await pause(150);
      const crop = {
        x: Math.floor(frame.range.x),
        y: Math.floor(frame.range.y - 3),
        width: Math.ceil(frame.range.width),
        height: 26,
      };
      const native = await window.webContents.capturePage(crop);
      const bitmap = native.toBitmap(),
        size = native.getSize();
      let minX = Infinity,
        maxX = -1,
        minY = Infinity,
        maxY = -1;
      for (let y = 0; y < size.height; y++)
        for (let x = 0; x < size.width; x++) {
          const offset = (y * size.width + x) * 4,
            b = bitmap[offset],
            g = bitmap[offset + 1],
            r = bitmap[offset + 2];
          if (r >= 45 && r <= 62 && g >= 128 && g <= 151 && b >= 220 && b <= 242) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      check(maxX >= minX, "blue native range thumb was not rendered");
      const blue = { x: crop.x + (minX + maxX + 1) / 2, y: crop.y + (minY + maxY + 1) / 2 };
      const delta = Math.hypot(blue.x - frame.dot.x, blue.y - frame.dot.y);
      check(delta < 1, `marker/thumb center mismatch at ${frame.value}s: ${delta}px`);
      check(frame.cueBelowTitle, "marker cue overlapped the recording title");
      check(frame.cueText.includes("演示"), "marker cue text is missing");
      check(frame.slotHeight === 24, "marker cue did not reserve its independent 24px slot");
      geometry.push({
        seconds: frame.value,
        blueCenter: blue,
        redCenter: frame.dot,
        deltaPx: delta,
      });
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.recording-marker-dot').forEach(dot=>dot.style.visibility='')",
      );
    }
    const expiry = await window.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      document.querySelectorAll('.recording-marker-dot')[1].click();await pause(50);
      const slot=document.querySelector('.recording-marker-cue-slot'), before=slot.getBoundingClientRect();
      const cueVisible=!!document.querySelector('.recording-marker-cue');await pause(2600);
      const after=slot.getBoundingClientRect();
      return {cueVisible,cueExpired:!document.querySelector('.recording-marker-cue'),slotStable:before.height===after.height&&before.top===after.top,
        autoCleanup:document.querySelector('[aria-label="自动清理不足10分钟或静音的录音"]')?.getAttribute('aria-pressed')==='true',
        noManualCleanup:![...document.querySelectorAll('button')].some(button=>/扫描|清理废录音|手动清理/.test(button.textContent)),
        transcriptVisible:document.body.textContent.includes('演示：大家先在中路集合')};
    })()`);
    check(
      Object.values(expiry).every(Boolean),
      `recording cue/cleanup regression: ${JSON.stringify(expiry)}`,
    );
    await window.webContents.executeJavaScript(
      "document.querySelectorAll('.recording-marker-dot')[2].click()",
    );
    await pause(70);
    await fs.writeFile(
      path.join(assetDirectory, "recording-library.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.voice-memory-detail').scrollIntoView({block:'start'})",
    );
    await pause(100);
    const region = await window.webContents.executeJavaScript(
      "(()=>{const r=document.querySelector('.voice-memory-detail').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.min(1000,Math.ceil(r.height))}})()",
    );
    await fs.writeFile(
      path.join(assetDirectory, "voice-memory-demo.png"),
      (await window.webContents.capturePage(region)).toPNG(),
    );
    const report = {
      passed: true,
      actualComponent: true,
      syntheticOnly: true,
      geometry,
      ...expiry,
      screenshots: ["recording-library.png", "voice-memory-demo.png"],
    };
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-recording-feedback-result.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    clearTimeout(deadline);
    window.destroy();
    app.quit();
  } catch (error) {
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-recording-feedback-failure.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
