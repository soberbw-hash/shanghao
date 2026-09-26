/** USB transport only: the returned MediaStream enters the same room DSP/recording path as local microphones. */
export class PhoneMicUsbReceiver {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private worker?: Worker;
  private stream?: MediaStream;

  async start(
    receiverUrl: string,
    onStatus: (connected: boolean, metrics?: { received: number; lost: number }) => void,
  ): Promise<MediaStream> {
    await this.stop();
    const context = new AudioContext({ sampleRate: 48_000 });
    this.context = context;
    const workletCode = `class UsbPlayback extends AudioWorkletProcessor {
      constructor(){super();this.queue=[];this.current=null;this.offset=0;this.started=false;this.port.onmessage=e=>{if(!e.data?.audioPort)return;const link=e.data.audioPort;link.onmessage=message=>{if(!(message.data instanceof ArrayBuffer))return;this.queue.push(new Float32Array(message.data));if(this.queue.length>12)this.queue.splice(0,this.queue.length-8)};link.start()}}
      process(_inputs,outputs){const out=outputs[0]?.[0];if(!out)return true;out.fill(0);if(!this.started){if(this.queue.length<3)return true;this.started=true}for(let i=0;i<out.length;i++){if(!this.current||this.offset>=this.current.length){this.current=this.queue.shift()||null;this.offset=0;if(!this.current){this.started=false;break}}out[i]=this.current[this.offset++]||0}return true}
    }registerProcessor('shanghao-usb-playback',UsbPlayback);`;
    const moduleUrl = URL.createObjectURL(new Blob([workletCode], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const node = new AudioWorkletNode(context, "shanghao-usb-playback", {
      outputChannelCount: [1],
    });
    this.node = node;
    const destination = context.createMediaStreamDestination();
    node.connect(destination);
    this.stream = destination.stream;
    const workerCode = `let ws,link,received=0,lost=0,last=-1,timer;
      self.onmessage=e=>{if(e.data?.type==='stop'){clearInterval(timer);ws?.close();link?.close();close();return}if(e.data?.type!=='start')return;link=e.data.port;link.start();ws=new WebSocket(e.data.url);ws.binaryType='arraybuffer';ws.onopen=()=>postMessage({type:'open'});ws.onerror=()=>postMessage({type:'error'});ws.onclose=()=>postMessage({type:'closed'});ws.onmessage=event=>{if(typeof event.data==='string'){try{const message=JSON.parse(event.data);if(message.type==='sender_connected')postMessage({type:'connected'});if(message.type==='sender_disconnected')postMessage({type:'disconnected'})}catch{}return}const frame=event.data;if(frame.byteLength!==1928)return;const sequence=new DataView(frame).getUint32(0,true);if(last>=0){const gap=(sequence-last-1)>>>0;if(gap<1000)lost+=gap;else if(sequence<=last)return}last=sequence;received++;const audio=frame.slice(8);link.postMessage(audio,[audio])};timer=setInterval(()=>postMessage({type:'metrics',received,lost}),1000)};`;
    const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
    let worker: Worker;
    try {
      worker = new Worker(workerUrl);
    } finally {
      URL.revokeObjectURL(workerUrl);
    }
    this.worker = worker;
    const channel = new MessageChannel();
    node.port.postMessage({ audioPort: channel.port1 }, [channel.port1]);
    worker.postMessage({ type: "start", url: receiverUrl, port: channel.port2 }, [channel.port2]);
    let senderConnected = false;
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker) return;
      if (data.type === "connected") {
        senderConnected = true;
        onStatus(true);
      } else if (data.type === "disconnected" || data.type === "closed" || data.type === "error") {
        senderConnected = false;
        onStatus(false);
      } else if (data.type === "metrics")
        onStatus(senderConnected, { received: data.received, lost: data.lost });
    };
    await context.resume();
    return destination.stream;
  }

  getStream(): MediaStream | undefined {
    return this.stream;
  }

  async stop(): Promise<void> {
    this.worker?.postMessage({ type: "stop" });
    this.worker?.terminate();
    this.worker = undefined;
    this.node?.disconnect();
    this.node = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") await context.close();
  }
}
