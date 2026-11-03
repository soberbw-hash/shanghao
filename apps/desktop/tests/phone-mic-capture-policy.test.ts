import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { PHONE_MIC_PAGE } from "../../../packages/signaling/src/phone-mic-page";
import { PHONE_MIC_USB_PAGE } from "../src/main/phone-mic-usb-page";

for (const [name, page] of [
  ["Wi-Fi", PHONE_MIC_PAGE],
  ["USB", PHONE_MIC_USB_PAGE],
]) {
  test(`${name} phone capture requests echo cancellation without a second gain/noise stage and releases the microphone on stop`, async () => {
    const elements = new Map<
      string,
      {
        disabled: boolean;
        textContent: string;
        style: object;
        children: object[];
        appendChild: (child: object) => void;
        classList: { toggle: () => void };
        onclick?: () => Promise<unknown>;
      }
    >();
    const element = (id: string) => {
      if (!elements.has(id)) {
        const children: object[] = [];
        elements.set(id, {
          disabled: false,
          textContent: "",
          style: {},
          children,
          appendChild: (child) => {
            children.push(child);
          },
          classList: { toggle: () => undefined },
        });
      }
      return elements.get(id)!;
    };
    let stopped = 0;
    let constraints: MediaStreamConstraints | undefined;
    const track = {
      stop: () => {
        stopped++;
      },
      getSettings: () => ({ sampleRate: 48000, echoCancellation: true }),
    };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    class Socket {
      static OPEN = 1;
      readyState = 1;
      bufferedAmount = 0;
      onopen?: () => void;
      onclose?: () => void;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }
    class Peer {
      addTrack() {}
      close() {}
      async createOffer() {
        return { sdp: "synthetic-offer" };
      }
      async setLocalDescription() {}
    }
    class Audio {
      sampleRate = 48000;
      destination = {};
      audioWorklet = { addModule: async () => undefined };
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return { disconnect() {}, getByteTimeDomainData() {} };
      }
      async close() {}
      async resume() {}
    }
    class BrowserURL extends URL {
      static createObjectURL() {
        return "blob:synthetic-worklet";
      }
      static revokeObjectURL() {}
    }
    const script = page!.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    runInNewContext(script, {
      navigator: {
        mediaDevices: {
          getUserMedia: async (value: MediaStreamConstraints) => {
            constraints = value;
            return stream;
          },
        },
      },
      document: { getElementById: element, createElement: element },
      location: {
        hash: "#id=test&code=local-fixture",
        protocol: "https:",
        host: "fixture.invalid",
        href: "https://fixture.invalid/phone-mic",
      },
      sessionStorage: { getItem: () => null, setItem() {} },
      URLSearchParams,
      URL: BrowserURL,
      Blob,
      WebSocket: Socket,
      RTCPeerConnection: Peer,
      AudioContext: Audio,
      AudioWorkletNode: class {
        port = {};
        connect() {}
        disconnect() {}
      },
      window: { addEventListener() {} },
      performance,
      setInterval: () => 1,
      clearInterval() {},
      setTimeout: () => 1,
      clearTimeout() {},
    });
    await element("toggle").onclick!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((constraints?.audio as MediaTrackConstraints)?.echoCancellation, true);
    assert.equal((constraints?.audio as MediaTrackConstraints)?.noiseSuppression, false);
    assert.equal((constraints?.audio as MediaTrackConstraints)?.autoGainControl, false);
    assert.equal(stopped, 0);
    await element("toggle").onclick!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(stopped, 1);
  });
}
