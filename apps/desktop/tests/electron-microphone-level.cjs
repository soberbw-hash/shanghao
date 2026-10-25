/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path"),
  fs = require("node:fs/promises"),
  os = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "microphone-level");
const reduced = process.argv.includes("--reduce-motion");
if (reduced) app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1260,
    height: 600,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const file = path.join(__dirname, "fixtures/microphone-level.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    view.showInactive();
    const result = await view.webContents.executeJavaScript(`(async()=>{
   const pause=ms=>new Promise(r=>setTimeout(r,ms));const check=(v,m)=>{if(!v)throw Error(m)};
   for(let i=0;i<100&&!document.querySelector('.microphone-level-fill')?.hasAttribute('data-active');i++)await pause(40);
   const shell=document.querySelector('.microphone-meter-shell');check(shell,'full capsule meter missing');
   const fill=shell.querySelector('.microphone-level-fill'); const viewport=fill.parentElement;
   const level=async(value,peerId='local-member')=>{window.dispatchEvent(new CustomEvent('shanghao:remote-audio-level',{detail:{peerId,level:value}}));await pause(210); if(peerId==='local-member'&&shell.querySelector('button').getAttribute('aria-pressed')==='false'){const target=viewport.getBoundingClientRect().height*(1-Math.sqrt(value));for(let i=0;i<40&&Math.abs(new DOMMatrixReadOnly(getComputedStyle(fill).transform).m42-target)>.2;i++)await pause(20);}};
   const snapshots=[];
   for(const [value,band,title] of [[.09,'green','低音量'],[.64,'yellow','较高音量'],[1,'red','高音量']]){
     await level(value);check(fill.dataset.band===band,'wrong level band '+band);
     const r=shell.getBoundingClientRect(),v=viewport.getBoundingClientRect(),f=fill.getBoundingClientRect();
     check(Math.abs(v.left-r.left)<1&&Math.abs(v.right-r.right)<1,'meter leaves left/right gutters');
     check(Math.abs(f.width-v.width)<1,'liquid fill does not span full capsule');
     check(Math.abs((v.bottom-f.top)-v.height*Math.sqrt(value))<1,'liquid height does not follow volume');
     check(Number(getComputedStyle(viewport).zIndex)<Number(getComputedStyle(shell.querySelector('button')).zIndex),'meter covers controls');
     if(value===1)check(Math.abs(f.top-v.top)<1&&Math.abs(f.bottom-v.bottom)<1,'full level did not reach entire capsule '+JSON.stringify({v:v.toJSON(),f:f.toJSON(),transform:getComputedStyle(fill).transform}));
     const standalone=document.querySelector('#standalone .microphone-level-viewport').getBoundingClientRect(),button=document.querySelector('#standalone button').getBoundingClientRect();
     check(Math.abs(standalone.width-button.width)<2.1,'standalone meter still constrained to text');
     const box=document.createElement('div');box.innerHTML='<p style="font-size:12px;color:#526b87;margin-bottom:10px">'+title+'</p>';const clone=shell.cloneNode(true);clone.style.setProperty('--room-dock-corner-radius',getComputedStyle(shell).getPropertyValue('--room-dock-corner-radius'));box.append(clone);document.querySelector('#samples').append(box);
     snapshots.push({band,height:Math.round(v.bottom-f.top),width:f.width});
   }
   await level(.09,'remote-peer');check(fill.dataset.band==='red','remote voice changed local meter');
   const ripple=getComputedStyle(fill,'::before');check(${reduced} ? ripple.animationName==='none' : ripple.animationPlayState==='running','incorrect motion preference');
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));check(fill.dataset.active==='false','hidden page keeps animating microphone');delete document.visibilityState;
   shell.querySelector('button').click();await pause(80);check(fill.dataset.active==='false','muting left the level visible');
   await level(1);check(fill.dataset.active==='false','muted microphone responds to audio');
   shell.querySelector('button').click();await pause(80);await level(0);check(fill.dataset.active==='false','silent microphone remains colored');
   const arrow=shell.querySelector('.voice-segmented-arrow');arrow.click();await pause(320);
   const popover=shell.querySelector('.audio-control-popover');check(popover&&popover.getBoundingClientRect().height>100,'device menu did not open');
   check(getComputedStyle(shell).overflow!=='hidden','meter clips device menu');arrow.click();await pause(100);
   return {fullCapsule:true,textAndIconsAbove:true,colorBands:snapshots,mutedHidden:true,remoteIgnored:true,hiddenPaused:true,deviceMenu:true,reducedMotion:${reduced}};
  })()`);
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "shanghao-microphone-preview-"));
    const crop = await view.webContents.executeJavaScript(
      "(()=>{const samples=document.querySelector('#samples'),r=samples.getBoundingClientRect(),last=samples.lastElementChild.getBoundingClientRect();return {x:Math.floor(r.x-10),y:Math.floor(r.y-10),width:Math.ceil(last.right-r.left+20),height:Math.ceil(r.height+20)}})()",
    );
    const screenshot = path.join(folder, "microphone-bands.png");
    await fs.writeFile(screenshot, (await view.webContents.capturePage(crop)).toPNG());
    console.log(JSON.stringify({ ...result, screenshot }));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
