/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "recording-search");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1440,
    height: 1080,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const fixture = path
      .join(__dirname, "fixtures/recording-library-feedback.html")
      .replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${fixture}`,
    );
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));const check=(v,m)=>{if(!v)throw Error(m)};
      const select=label=>document.querySelector('select[aria-label="'+label+'"]');
      const choose=(label,value)=>{const el=select(label);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))};
      for(let i=0;i<100&&!select('筛选录音房间');i++)await pause(40);await pause(250);
      check(select('筛选录音房间'),'recording room filter missing');
      check(!document.querySelector('[aria-label="搜索录音文字"]'),'removed search field remains');
      check(!document.querySelector('input[type="date"]'),'removed date fields remain');
      choose('筛选转录状态','has');await pause(80);
      for(let i=0;i<100&&document.querySelectorAll('.recording-date-item').length!==1;i++)await pause(40);
      check(document.querySelectorAll('.recording-date-item').length===1,'transcript filter did not use saved metadata');
      choose('筛选录音房间','unassigned');await pause(80);
      check(document.querySelectorAll('.recording-date-item').length===0,'room filter included another room');
      choose('筛选录音房间','main');await pause(80);
      check(document.querySelectorAll('.recording-date-item').length===1,'retained room filter did not recover');
      return {dateAndSearchRemoved:true,roomFilter:true,transcriptFilter:true};
    })()`);
    if (process.env.SHANGHAO_TEST_SCREENSHOT)
      require("node:fs").writeFileSync(
        process.env.SHANGHAO_TEST_SCREENSHOT,
        (await view.webContents.capturePage()).toPNG(),
      );
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
