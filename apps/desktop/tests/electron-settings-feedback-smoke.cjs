/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises"),
  os = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "settings-feedback");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 1450,
    height: 1000,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  view.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(event.message);
  });
  try {
    const file = path.join(__dirname, "visual/settings-feedback.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async()=>{
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(ok,msg)=>{if(!ok)throw Error(msg)};
      for(let i=0;i<80&&!document.querySelector('[aria-label="文本整理与问答模型"]');i++)await pause(50);
      const select=document.querySelector('select[aria-label="文本整理与问答模型"]');
      check(select,'settings did not mount');
      check(document.querySelector('.recording-marker-cue')?.textContent.includes('时钟 09点47分'),'clock unit missing');
      document.querySelector('#ai-model-management').querySelector('summary').click();await pause(40);
      check(select.checkVisibility(),'advanced model configuration did not open');
      select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));await pause(100);
      check(select.value==='custom','custom API selection snapped back to GLM');
      const forms=[...document.querySelectorAll('.ai-provider-fields')];
      check(forms.length===2,'provider forms are inconsistent');
      check(forms.every(el=>el.querySelectorAll('label').length===3),'missing provider field labels');
      const textPanel=select.closest('.ai-model-provider-panel');
      check(select.options.length===2,'duplicate text presets were not removed');
      const setInput=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      setInput(textPanel.querySelectorAll('input')[0],'https://api.deepseek.com');
      setInput(textPanel.querySelectorAll('input')[1],'deepseek-flash');await pause(80);
      check(textPanel.querySelector('input[type=password]').placeholder.includes('此服务'),'another provider key falsely shown as usable');
      const save=[...textPanel.querySelectorAll('button')].find(b=>b.textContent==='保存');
      check(save.disabled,'switching provider with no matching key must require its own key');
      const key=textPanel.querySelector('input[type=password]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(key,'fixture-deepseek-key');
      key.dispatchEvent(new Event('input',{bubbles:true}));await pause(50);save.click();await pause(100);
      check(select.value==='custom','saved custom API did not remain selected');
      check(document.querySelector('.ai-overview-grid').textContent.includes('deepseek-flash'),'current model summary did not follow saved provider');
      for(const text of ['custom','cloud'])for(const asr of ['cloud','hybrid','custom']){
        select.value=text;select.dispatchEvent(new Event('change',{bubbles:true}));
        const source=document.querySelector('[aria-label="语音转录模型来源"]');source.value=asr;source.dispatchEvent(new Event('change',{bubbles:true}));await pause(40);
        const panels=[...document.querySelectorAll('.ai-model-provider-panel')].map(p=>p.getBoundingClientRect());
        check(Math.abs(panels[0].top-panels[1].top)<1&&Math.abs(panels[0].bottom-panels[1].bottom)<1,'model panels not aligned: '+text+'/'+asr);
      }
      window.dispatchEvent(new CustomEvent('shanghao:remote-audio-level',{detail:{peerId:'local-member',level:0.64}}));await pause(170);
      const meter=document.querySelector('.microphone-level-fill');
      check(meter.dataset.active==='true'&&meter.style.transform.includes('20'),'meter did not follow local level');
      document.querySelector('.microphone-meter-control').click();await pause(50);
      check(meter.dataset.active==='false'&&meter.style.transform.includes('100'),'muting did not clear meter');
      await pause(2600);
      check(!document.querySelector('.recording-marker-cue'),'marker cue did not expire while paused');
      return {passed:true,customApiSelectable:true,providerFormsUnified:true,providerSaveCommitted:true,providerKeyIsolation:true,equalHeightCombinations:6,localMeter:true,mutedMeterHidden:true,clockUnits:true,transientMarker:true};
    })()`,
      true,
    );
    await view.webContents.executeJavaScript(`(()=>{
      const text=document.querySelector('select[aria-label="文本整理与问答模型"]');text.value='cloud';text.dispatchEvent(new Event('change',{bubbles:true}));
      const asr=document.querySelector('[aria-label="语音转录模型来源"]');asr.value='hybrid';asr.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('.ai-model-provider-grid').scrollIntoView({block:'center'});
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-settings-feedback.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    view.setContentSize(1120, 950);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const narrow = await view.webContents.executeJavaScript(`(()=>{
      const panels=[...document.querySelectorAll('.ai-model-provider-panel')].map(p=>p.getBoundingClientRect());
      const model=document.querySelector('[aria-label="本地辅助模型"]'),style=getComputedStyle(model);
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=style.font;
      return {noOverflow:document.documentElement.scrollWidth<=innerWidth,
        equalHeight:Math.abs(panels[0].bottom-panels[1].bottom)<1&&Math.abs(panels[0].top-panels[1].top)<1,
        modelLabelFits:ctx.measureText(model.selectedOptions[0].textContent).width<=model.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-20};
    })()`);
    if (!Object.values(narrow).every(Boolean))
      throw Error("narrow model layout: " + JSON.stringify(narrow));
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-settings-feedback-narrow.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    result.narrow = narrow;
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}?read-error`,
    );
    result.providerReadRecovery = await view.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(ok,msg)=>{if(!ok)throw Error(msg)};
      for(let i=0;i<80&&!document.body.textContent.includes('这不代表密钥已丢失');i++)await pause(50);
      document.querySelector('#ai-model-management summary').click();await pause(50);
      check(document.body.textContent.includes('这不代表密钥已丢失'),'read error was hidden');
      check(!document.body.textContent.includes('请先配置当前转录 API 密钥'),'read failure presented as missing key');
      check(!document.querySelector('input[type=password]'),'unreadable configuration offered replacement credentials');
      const retry=[...document.querySelectorAll('button')].find(b=>b.textContent==='重试读取');
      check(retry&&!retry.disabled,'read-only retry unavailable');window.dispatchEvent(new Event('fixture:provider-recovered'));retry.click();
      for(let i=0;i<80&&document.querySelectorAll('input[type=password]').length!==2;i++)await pause(50);
      check(document.querySelectorAll('input[type=password]').length===2,'retry did not recover both provider forms');
      check(!document.body.textContent.includes('这不代表密钥已丢失'),'stale read error remained after recovery');
      return true;
    })()`);
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}?cold-ai-open`,
    );
    result.coldAiLayout = await view.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const until=async(predicate,message)=>{
        for(let i=0;i<80;i++){if(predicate())return;await pause(50);}
        throw Error(message);
      };
      const overview=()=>document.querySelector('.ai-overview-grid');
      await until(overview,'cold AI open did not paint the overview before loading data');
      await document.fonts.ready;
      const selectors=['.ai-overview-grid','#transcription-settings-title','#ai-model-management'];
      const positions=()=>selectors.map(s=>document.querySelector(s).getBoundingClientRect().top);
      const initial=positions();
      const checkPosition=(step)=>{
        if(positions().some((top,i)=>Math.abs(top-initial[i])>1))throw Error('cold AI layout shifted: '+step);
      };
      window.dispatchEvent(new Event('fixture:ai-snapshot-ready'));
      await until(()=>overview().textContent.includes('0 个转录'),'model state never arrived');
      checkPosition('model state');
      window.dispatchEvent(new Event('fixture:ai-providers-ready'));
      await until(()=>overview().textContent.includes('glm-4-flash-250414')&&document.querySelector('[aria-label="语音转录模型来源"]').value==='hybrid','provider state never arrived');
      checkPosition('provider state');
      const source=document.querySelector('[aria-label="语音转录模型来源"]');
      const local=document.querySelector('[aria-label="本地辅助模型"]');
      if ([...source.options].filter(o=>!o.hidden).map(o=>o.value).join(',') !== 'cloud,hybrid,custom' ||
          local.value !== 'qwen3-asr-0.6b-force' || !local.selectedOptions[0].textContent.includes('均衡识别'))
        throw Error('fresh transcription settings did not use cloud with balanced local assistance');
      return true;
    })()`);
    view.setContentSize(1120, 630);
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}?full-settings`,
    );
    result.settingsNavigation = await view.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      const wait=async(check,error)=>{
        for(let i=0;i<80;i++){if(check())return;await pause(50);}
        throw Error(error);
      };
      const find=selector=>document.querySelector(selector);
      const models=()=>find('#ai-model-management');
      await wait(models,'AI settings did not render');
      await document.fonts.ready;
      await pause(420);
      const nav=find('nav[aria-label="设置栏目"]');
      const navTop=nav.getBoundingClientRect().top;
      const scroller=find('[data-settings-content-scroll]');
      const admin=()=>find('[aria-label="展开管理员功能"]');
      if(admin())throw Error('administrator controls still available under AI settings');
      models().querySelector('summary').click();
      await wait(()=>scroller.scrollTop>0,'model section did not scroll on opening');
      await pause(450);
      const header=models().querySelector('summary').getBoundingClientRect();
      const clip=scroller.getBoundingClientRect();
      if(header.top<clip.top || header.bottom>clip.bottom)throw Error('model heading left the viewport');
      scroller.scrollTop=scroller.scrollHeight;
      await pause(100);
      if(Math.abs(nav.getBoundingClientRect().top-navTop)>1)
        throw Error('settings sidebar moved with the content');
      const source=find('select[aria-label="语音转录模型来源"]');
      if(source.value!=='local' || [...source.options].filter(o=>!o.hidden).map(o=>o.value).join(',')!=='cloud,hybrid,custom')
        throw Error('legacy offline configuration changed the usual choices or its active mode');
      source.value='hybrid';source.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>find('[aria-label="本地辅助模型"]')?.value==='qwen3-asr-0.6b-force','hybrid mode did not reveal the balanced model');
      [...nav.querySelectorAll('button')].find(b=>b.textContent==='关于上号').click();
      await wait(admin,'administrator controls were not moved to About');
      admin().click();
      await wait(()=>document.body.textContent.includes('上传密钥文件'),'admin key gate missing');
      return true;
    })()`);
    view.setContentSize(1120, 950);
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}?update`,
    );
    const geometry = await view.webContents.executeJavaScript(`(async()=>{
      const find=(selector)=>document.querySelector(selector);
      for(let i=0;i<80&&!find('.update-modal-surface');i++)await new Promise(r=>setTimeout(r,50));
      await new Promise(r=>setTimeout(r,300));
      const center=(node)=>{const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};};
      const composer=find('input[aria-label="聊天消息"]'), point=center(composer);
      if(document.elementFromPoint(point.x,point.y)!==composer)throw Error('required download blocks the composer');
      return { composer:point, handle:center(find('[title="拖动更新窗口"]')), card:center(find('.update-modal-surface')) };
    })()`);
    view.webContents.sendInputEvent({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      ...geometry.composer,
    });
    view.webContents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      ...geometry.composer,
    });
    view.webContents.sendInputEvent({ type: "char", keyCode: "x" });
    const { x, y } = geometry.handle;
    view.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x, y });
    for (let i = 1; i <= 5; i++) {
      view.webContents.sendInputEvent({ type: "mouseMove", x: x - 20 * i, y: y - 14 * i });
      await new Promise((resolve) => setTimeout(resolve, 24));
    }
    view.webContents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      x: x - 100,
      y: y - 70,
    });
    result.updateDuringChat = await view.webContents.executeJavaScript(`(()=>{
      const box=document.querySelector('.update-modal-surface').getBoundingClientRect();
      if(document.querySelector('input[aria-label="聊天消息"]').value!=='x')throw Error('typing during update failed');
      if(box.x+box.width/2>${geometry.card.x - 60})throw Error('header did not drag the update card');
      return true;
    })()`);
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
