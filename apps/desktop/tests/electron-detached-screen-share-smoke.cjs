/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path"),
  fs = require("node:fs/promises"),
  os = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "screen-forwarding");
const deadline = setTimeout(() => app.exit(1), 35000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 820,
    height: 560,
    title: "上号 · 远端屏幕放大检查",
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const file = path.join(__dirname, "visual/detached-screen-share.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}?screenViewerSession=fixture-share`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<100;i++){
        const error=document.querySelector('#fixture-error')?.textContent;if(error)throw Error(error);
        const video=document.querySelector('video');
        if(video&&video.videoWidth>0&&video.currentTime>.3){
          const before=video.currentTime;await pause(250);
          if(video.currentTime>before){
            const old=video.srcObject;document.querySelector('#fixture-restart').click();
            for(let retry=0;retry<80;retry++){
              const error=document.querySelector('#fixture-error')?.textContent;if(error)throw Error(error);
              if(video.srcObject!==old&&video.videoWidth>0&&video.currentTime>.3)return {passed:true,width:video.videoWidth,height:video.videoHeight,framesAdvancing:true,forwardedRemoteTrack:true,replacementTransportDecoded:true};
              await pause(100);
            }
            throw Error('replacement publisher did not recover enlarged viewing');
          }
        }
        await pause(150);
      }
      throw Error('enlarged viewer did not decode advancing remote frames');
    })()`,
      true,
    );
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-screen-forwarding-result.json"),
      JSON.stringify(result, null, 2),
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
