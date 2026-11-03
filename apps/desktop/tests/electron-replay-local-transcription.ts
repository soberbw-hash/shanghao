import { app, BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { registerVoiceReplayIpc } from "../src/main/voice-replay-ipc";

require(path.resolve("tests/electron-isolated-profile.cjs")).configureIsolatedProfile(
  app,
  "replay-local-transcription",
);
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 30_000);
void app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.resolve("dist-electron/preload/index.cjs") },
  });
  let calls = 0;
  registerVoiceReplayIpc(
    () => view,
    async (filePath, duration) => {
      calls++;
      if (
        path.basename(filePath) !== "audio.wav" ||
        duration !== 1000 ||
        (await fs.stat(filePath)).size !== 32044
      )
        throw Error("unexpected_replay_input");
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "合成本地文字";
    },
  );
  try {
    await view.loadURL("data:text/html,<title>isolated replay test</title>");
    const result = await view.webContents.executeJavaScript(`(async () => {
      const data = new Uint8Array(32044); const v = new DataView(data.buffer);
      const ascii=(offset,text)=>[...text].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));
      ascii(0,'RIFF');v.setUint32(4,32036,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);
      v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);
      v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
      ascii(36,'data');v.setUint32(40,32000,true);
      const api=window.desktopApi.voiceReplay;const clip=await api.save('隔离片段',data);
      const before=await api.read(clip.id); const first=api.transcribeLocal(clip.id);
      const second=api.transcribeLocal(clip.id).then(()=>false,()=>true);
      const [text,rejected]=await Promise.all([first,second]); const after=await api.read(clip.id);
      const saved=await api.readTranscript(clip.id);
      if(text!=='合成本地文字'||saved!==text||!rejected||before.length!==after.length||!before.every((x,i)=>x===after[i]))throw Error('replay transcription failed');
      return { text, saved: true, secondRejected: rejected, unchanged: true };
    })()`);
    if (calls !== 1) throw Error("model_called_more_than_once");
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    view.destroy();
    clearTimeout(deadline);
    app.exit(process.exitCode || 0);
  }
});
