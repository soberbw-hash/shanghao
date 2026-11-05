/* global require, process, console, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "admin-panel");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ width: 1000, height: 850, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  try {
    const file = path.resolve("tests/fixtures/admin-panel.html").replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5174/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(ok,why)=>{if(!ok)throw Error(why)};
      const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
      for(let i=0;i<100&&!document.querySelector('section>button');i++)await wait(40);
      document.querySelector('section>button').click(); await wait(30);
      button('上传密钥文件').click(); await wait(80);
      check(document.documentElement.dataset.imported==='true','key import not requested');
      [...document.querySelectorAll('section button')].find(b=>b.textContent.includes('云端服务管理')).click(); await wait(30);
      button('添加服务').click(); await wait(30);
      const input=(label,value)=>{
        const field=[...document.querySelectorAll('label')].find(l=>l.textContent.includes(label))?.querySelector('input');
        check(field,'missing '+label);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);
        field.dispatchEvent(new Event('input',{bubbles:true}));
      };
      input('服务名称','隔离测试服务'); input('模型名称','synthetic-model'); input('API 密钥','synthetic-test-key'); await wait(30);
      const form=document.querySelector('form');
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await wait(180);
      check(document.documentElement.dataset.mutations==='1','double submission reached server');
      check(document.querySelectorAll('article').length===1,'saved provider missing');
      check(!document.body.textContent.includes('synthetic-test-key'),'secret returned to presentation');
      button('启用').click(); await wait(30);
      check(document.documentElement.dataset.mutations==='1','activation skipped confirmation');
      button('确认').click(); await wait(150);
      check(document.querySelector('article').textContent.includes('当前启用'),'activation not shown');
      button('修改').click(); await wait(30);
      check(document.querySelector('input[type=password]').value==='','saved key exposed when editing');
      button('取消').click(); await wait(30);
      button('停用').click(); await wait(30); button('确认').click(); await wait(150);
      check(document.querySelector('article').textContent.includes('已停用'),'disable not shown');
      button('设为备用').click(); await wait(30); button('确认').click(); await wait(150);
      check(document.querySelector('article').textContent.includes('备用服务'),'fallback selection not shown');
      button('修改').click(); await wait(30); input('模型名称','updated-model');
      document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await wait(30);
      check(document.documentElement.dataset.mutations==='4','fallback edit skipped confirmation');
      button('确认').click(); await wait(150);
      button('取消备用').click(); await wait(30); button('确认').click(); await wait(150);
      check(document.querySelector('article').textContent.includes('已停用'),'cleared fallback not shown');
      button('删除').click(); await wait(30); button('取消').click(); await wait(30);
      check(document.querySelectorAll('article').length===1,'cancel deleted provider');
      button('删除').click(); await wait(30); button('确认').click(); await wait(150);
      check(document.querySelectorAll('article').length===0,'delete not shown');
      check(document.documentElement.dataset.mutations==='7','unexpected mutation count');
      return { add:true, doubleSubmitBlocked:true, activationConfirmed:true, disable:true, fallback:true, deleteConfirmed:true, keyNotReturned:true };
    })()`);
    console.log(JSON.stringify(result));
  } catch(error) { console.error(error); process.exitCode = 1; }
  finally { view.destroy(); clearTimeout(deadline); app.exit(process.exitCode || 0); }
});
