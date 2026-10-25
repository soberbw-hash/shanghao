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
    webPreferences: { backgroundThrottling: false, offscreen: true },
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
    await window.webContents.executeJavaScript(
      `(async()=>{for(let i=0;i<150;i++){if(document.querySelector('.recording-timeline')?.max==='800'&&document.querySelector('.recording-overview')&&document.querySelector('.transcript-paragraph')){await document.fonts.ready;return;}await new Promise(r=>setTimeout(r,40));}throw Error('recording fixture did not mount')})()`,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.recording-detail-swap').getAnimations().forEach(animation=>animation.finish())",
    );
    await window.webContents.executeJavaScript(`(()=>{
      const text=document.querySelector('.voice-memory-detail');
      const clips=document.querySelector('.recording-clips-panel');
      if(!text.textContent.includes('先集合、补足河道视野'))throw Error('saved legacy summary disappeared');
      if(!(text.compareDocumentPosition(clips)&Node.DOCUMENT_POSITION_FOLLOWING))throw Error('clip tools push transcript below the first screen');
    })()`);
    const readingLayout = await window.webContents.executeJavaScript(`(()=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect();
      const toolbar=rect('.recording-library-toolbar'), first=rect('.transcript-paragraph');
      const text=rect('.voice-memory-detail'), panel=rect('.recording-library-panel');
      if(toolbar.height>40)throw Error('library storage header consumes a separate card');
      if(first.top>panel.top+280)throw Error('transcript still pushed below controls');
      if(panel.bottom-first.top<innerHeight*.45)throw Error('transcript gets too little first-screen reading space');
      const source=document.querySelector('.transcript-source-control');
      const timeline=document.querySelector('.voice-memory-timeline');
      if(!(source.compareDocumentPosition(timeline)&Node.DOCUMENT_POSITION_FOLLOWING))throw Error('timeline appears before text');
      const storage=document.querySelector('.recording-storage-settings');
      storage.querySelector('summary').click();
      if(!document.querySelector('[aria-label="录音库自动清理容量上限"]').checkVisibility())throw Error('storage controls cannot open');
      if(rect('.transcript-paragraph').top!==first.top)throw Error('storage settings displaced transcript');
      storage.querySelector('summary').click();
      return {toolbarHeight:toolbar.height,firstParagraphTop:first.top,readingSpace:panel.bottom-first.top};
    })()`);
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
        autoCleanup:document.querySelector('[aria-label="自动清理整段静音的录音"]')?.getAttribute('aria-pressed')==='true',
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
    window.setContentSize(1120, 950);
    await pause(120);
    const narrow = await window.webContents.executeJavaScript(`(()=>{
      document.querySelector('.recording-processing-settings').open=true;
      const paragraph=document.querySelector('.transcript-paragraph span');
      return {
        noOverflow:document.documentElement.scrollWidth<=innerWidth,
        readableText:parseFloat(getComputedStyle(paragraph).fontSize)>=14,
        transcriptWidth:paragraph.getBoundingClientRect().width,
      };
    })()`);
    check(
      narrow.noOverflow && narrow.readableText && narrow.transcriptWidth > 300,
      "narrow recording layout: " + JSON.stringify(narrow),
    );
    await pause(60);
    await fs.writeFile(
      path.join(assetDirectory, "recording-library-narrow.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const summaryStates = [];
    await window.webContents.executeJavaScript(
      "document.querySelector('.recording-processing-settings').open=false",
    );
    await pause(80);
    await fs.writeFile(
      path.join(assetDirectory, "recording-library-narrow-reading.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    for (const state of ["organizing", "failed"]) {
      await window.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('recording-fixture-state',{detail:'${state}'}))`,
      );
      await pause(80);
      summaryStates.push(
        await window.webContents.executeJavaScript(`(()=>{
        document.querySelector('.recording-library-panel').scrollTop=0;
        const overview=document.querySelector('.recording-overview'), paragraph=document.querySelector('.transcript-paragraph');
        const first=paragraph.getBoundingClientRect(), panel=document.querySelector('.recording-library-panel').getBoundingClientRect();
        if(overview.getBoundingClientRect().height>40)throw Error('empty summary became a large panel');
        if(first.top>panel.top+280)throw Error('summary state pushes transcript below first screen');
        if(document.querySelector('.voice-memory-audio-trajectory'))throw Error('decorative processing block restored');
        const details=document.querySelector('.voice-memory-organization');
        if(!(paragraph.compareDocumentPosition(details)&Node.DOCUMENT_POSITION_FOLLOWING))throw Error('processing details precede transcript');
        return {status:overview.textContent,firstParagraphTop:first.top};
      })()`),
      );
      await fs.writeFile(
        path.join(assetDirectory, `recording-library-${state}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    window.setContentSize(1440, 1080);
    await window.webContents.executeJavaScript(
      "window.dispatchEvent(new CustomEvent('recording-fixture-state',{detail:'dense'}));document.querySelector('.recording-library-panel').scrollTop=0",
    );
    await pause(250);
    const density = await window.webContents.executeJavaScript(`(()=>{
      const rows=[...document.querySelectorAll('.transcript-paragraph')], first=rows[0];
      const textStyle=getComputedStyle(first.querySelector('span')), rowStyle=getComputedStyle(first);
      const visibleRows=rows.filter(row=>{const r=row.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}).length;
      if(parseFloat(textStyle.fontSize)!==14||parseFloat(textStyle.lineHeight)>22.5)throw Error('transcript typography too loose');
      if(parseFloat(rowStyle.columnGap)>6||parseFloat(rowStyle.paddingTop)>6)throw Error('transcript gutters too loose');
      if(visibleRows<17)throw Error('too few paragraphs fit in reading viewport: '+visibleRows);
      return {visibleRows,fontSize:parseFloat(textStyle.fontSize),lineHeight:parseFloat(textStyle.lineHeight),rowHeight:first.getBoundingClientRect().height,columnGap:parseFloat(rowStyle.columnGap)};
    })()`);
    await fs.writeFile(
      path.join(assetDirectory, "recording-library-dense.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const report = {
      passed: true,
      actualComponent: true,
      syntheticOnly: true,
      geometry,
      ...expiry,
      narrow,
      readingLayout,
      summaryStates,
      density,
      screenshotDirectory: assetDirectory,
      screenshots: [
        "recording-library.png",
        "voice-memory-demo.png",
        "recording-library-narrow.png",
        "recording-library-narrow-reading.png",
        "recording-library-organizing.png",
        "recording-library-failed.png",
        "recording-library-dense.png",
      ],
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
