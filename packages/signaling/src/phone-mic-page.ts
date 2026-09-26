// Kept self-contained so the relay can serve it without a second web deployment.
// The pairing secret lives in the URL fragment and is never sent in the HTTP request.
export const PHONE_MIC_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>上号 · 手机麦克风</title>
<style>
:root{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;color:#20324b;background:#dce9ff;color-scheme:light}
*{box-sizing:border-box}body{min-height:100dvh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 85% 12%,#fff6e4 0,transparent 38%),linear-gradient(145deg,#b8d5ff,#e9f3ff 65%,#c3dcff)}
main{width:min(100%,390px);padding:28px;border:1px solid #fff;background:#ffffffd9;box-shadow:0 22px 70px #4778b536;border-radius:28px;backdrop-filter:blur(18px)}
header{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:.05em}header b{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:#172539;color:white}
h1{font-size:25px;margin:30px 0 8px}p{line-height:1.6;color:#61738b;margin:0 0 18px}.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid #c9dcf5;border-radius:999px;padding:8px 12px;background:white;font-size:13px;font-weight:700}
.dot{width:8px;height:8px;border-radius:50%;background:#aabbd1}.connected .dot{background:#28b685;box-shadow:0 0 0 4px #28b68523}.meter{height:68px;display:flex;align-items:center;justify-content:center;gap:4px;margin:20px 0}.meter span{width:8px;height:10px;border-radius:8px;background:#7ca8e7;transition:height .09s linear}
button{border:0;border-radius:14px;background:#448ee7;color:white;font:700 16px inherit;width:100%;padding:15px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.secondary{background:#ebf2fb;color:#36567c;margin-top:9px}
small{display:block;color:#7890aa;margin-top:18px;line-height:1.5}#error{color:#b54e59;min-height:22px;margin-top:12px;font-size:13px}
</style></head><body><main><header><b>上</b><span>SHANGHAO · 上号</span></header><h1>手机麦克风</h1><p>连接电脑后，手机声音会进入上号当前房间。</p>
<div id="state" class="pill"><i class="dot"></i><span id="label">正在配对…</span></div>
<div id="meter" class="meter" aria-label="实时音量"></div><button id="toggle" disabled>开始传输</button><button id="disconnect" class="secondary">断开连接</button><div id="error" role="alert"></div><small id="details">请保持这个页面打开。使用耳机可避免扬声器回声。</small></main>
<script>
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const sessionId = params.get('id');
  const pairingSecret = params.get('code');
  const storageKey = 'shanghao-phone-mic-' + sessionId;
  const label = document.getElementById('label');
  const state = document.getElementById('state');
  const toggle = document.getElementById('toggle');
  const error = document.getElementById('error');
  const details = document.getElementById('details');
  const bars = document.getElementById('meter');
  for(let i=0;i<15;i++) bars.appendChild(document.createElement('span'));
  let socket, peer, stream, meterContext, meterSource, analyser, meterTimer, reconnectTimer, peerRetryTimer, attempts=0, peerAttempts=0, iceServers=[], pendingCandidates=[];
  const send = (value) => { if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const setState = (text, ok=false) => { label.textContent=text; state.classList.toggle('connected',ok); };
  const setError = (value) => { error.textContent=value; };
  const stopMedia = () => {
    clearInterval(meterTimer); meterTimer=undefined;clearTimeout(peerRetryTimer);peerRetryTimer=undefined;
    meterSource?.disconnect(); meterSource=undefined; analyser?.disconnect(); analyser=undefined;
    meterContext?.close().catch(()=>{}); meterContext=undefined;
    stream?.getTracks().forEach(track=>track.stop()); stream=undefined;
    peer?.close(); peer=undefined; toggle.textContent='开始传输';
  };
  const createPeer = async () => {
    peer?.close(); pendingCandidates=[]; peer=new RTCPeerConnection({iceServers});
    peer.onicecandidate=({candidate})=>{if(candidate) send({type:'candidate',candidate});};
    peer.onconnectionstatechange=()=>{
      if(peer?.connectionState==='connected'){peerAttempts=0;setState('正在传输',true);}
      if(peer?.connectionState==='failed' && stream && socket?.readyState===WebSocket.OPEN){
        setState('网络中断，正在恢复…');
        if(peerAttempts++<8) peerRetryTimer=setTimeout(()=>createPeer().catch(()=>{}),Math.min(1000*peerAttempts,5000));
        else setError('音频连接未能恢复，请停止后重试。');
      }
    };
    stream.getTracks().forEach(track=>peer.addTrack(track,stream));
    const offer=await peer.createOffer(); await peer.setLocalDescription(offer);
    send({type:'offer',sdp:offer.sdp});
  };
  const connect = () => {
    if(!sessionId || !pairingSecret){setState('二维码无效');setError('请在电脑上重新打开手机麦克风。');return;}
    const url=new URL('/phone-mic/ws',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    socket=new WebSocket(url);
    socket.onopen=()=>send({type:'join',sessionId,secret:sessionStorage.getItem(storageKey)||pairingSecret});
    socket.onmessage=async ({data})=>{try{
      const message=JSON.parse(data);
      if(message.type==='joined'){
        sessionStorage.setItem(storageKey,message.resumeSecret); iceServers=message.iceServers||[];
        attempts=0;setState('已连接',true);toggle.disabled=false;setError('');
        if(stream) await createPeer();
      } else if(message.type==='answer' && peer){await peer.setRemoteDescription({type:'answer',sdp:message.sdp});for(const candidate of pendingCandidates.splice(0)){try{await peer.addIceCandidate(candidate)}catch{}}}
      else if(message.type==='candidate' && peer){if(peer.remoteDescription){try{await peer.addIceCandidate(message.candidate)}catch{}}else pendingCandidates.push(message.candidate);}
    }catch(e){setError('连接协商失败，请重试。');}};
    socket.onclose=()=>{
      toggle.disabled=true;setState('连接中断，正在重连…');
      if(attempts++<12) reconnectTimer=setTimeout(connect,Math.min(1000*2**attempts,8000));
      else {setState('连接已结束');stopMedia();setError('请在电脑上重新打开手机麦克风并扫码。');}
    };
  };
  toggle.onclick=async()=>{
    if(stream){send({type:'stop'});stopMedia();return;}
    try{
      setError('');toggle.disabled=true;
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
      const settings=stream.getAudioTracks()[0].getSettings();
      details.textContent='麦克风：'+(stream.getAudioTracks()[0].label||'系统默认')+' · '+(settings.sampleRate||'设备原生')+' Hz';
      meterContext=new AudioContext();meterSource=meterContext.createMediaStreamSource(stream);
      analyser=meterContext.createAnalyser();analyser.fftSize=512;meterSource.connect(analyser);
      const values=new Uint8Array(analyser.fftSize);
      meterTimer=setInterval(()=>{analyser.getByteTimeDomainData(values);let sum=0;for(const value of values){const x=(value-128)/128;sum+=x*x;}const level=Math.min(1,Math.sqrt(sum/values.length)*5);for(const [i,bar] of [...bars.children].entries())bar.style.height=(10+Math.max(0,level*(1-Math.abs(i-7)/10))*48)+'px';},60);
      await createPeer();toggle.textContent='停止传输';setState('正在传输',true);
    }catch(e){stopMedia();setError(e?.name==='NotAllowedError'?'请在浏览器中允许使用麦克风。':'麦克风启动失败：'+(e?.message||e));}
    finally{toggle.disabled=false;}
  };
  document.getElementById('disconnect').onclick=()=>{clearTimeout(reconnectTimer);socket.onclose=null;socket.close();stopMedia();setState('已断开');toggle.disabled=true;};
  window.addEventListener('pagehide',()=>{clearTimeout(reconnectTimer);if(socket)socket.onclose=null;socket?.close();stopMedia();});
  connect();
})();
</script></body></html>`;
