/* eslint-disable @typescript-eslint/no-require-imports */
/* global Buffer, clearTimeout, console, process, require, setTimeout */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, session } = require("electron");

const PEER_IDS = ["A", "B", "C", "D", "E"];
const INITIAL_TIMEOUT_MS = 24_000;
const RECOVERY_TIMEOUT_MS = 12_000;
const CHANNEL = "five-peer-media";
const FAKE_AUDIO_PATH = path.join(os.tmpdir(), `shanghao-five-peer-${process.pid}.wav`);
const TEST_HTML_PATH = path.join(os.tmpdir(), `shanghao-five-peer-${process.pid}.html`);

const writeFakeMicrophoneAudio = () => {
  // Chromium's fake audio capture switch expects 44.1 kHz mono PCM WAV.
  // Playback still runs at 48 kHz, covering the real resampling boundary.
  const sampleRate = 44_100;
  const durationSeconds = 8;
  const sampleCount = sampleRate * durationSeconds;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.18;
    buffer.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  fs.writeFileSync(FAKE_AUDIO_PATH, buffer);
};

writeFakeMicrophoneAudio();

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch(
  "use-file-for-fake-audio-capture",
  FAKE_AUDIO_PATH.replaceAll("\\", "/"),
);

const windows = new Map();
const reports = new Map();
const readyPeers = new Set();
let phase = "initial";
let phaseTimer;
let isFinished = false;

const rendererScript = `
  const { ipcRenderer } = require("electron");
  const channel = ${JSON.stringify(CHANNEL)};
  const peerId = new URLSearchParams(location.hash.slice(1)).get("peerId");
  void (async () => {
  const peerConnections = new Map();
  const inboundTracks = new Map();
  const playbackNodes = new Map();
  const pendingIceCandidates = new Map();
  const playbackContext = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  const silentPlaybackGain = playbackContext.createGain();
  // Keep both graphs renderable. Chromium may stop pulling a fully silent graph,
  // which would make RTP counters grow while no decoded samples reach playback.
  silentPlaybackGain.gain.value = 0.0001;
  silentPlaybackGain.connect(playbackContext.destination);
  void playbackContext.resume();

  const createCapturedMediaAudioStream = async () => {
    const audio = new Audio(
      new URL(${JSON.stringify(path.basename(FAKE_AUDIO_PATH))}, location.href).href,
    );
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0.0001;
    await audio.play();
    const stream = audio.captureStream?.();
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track) {
      audio.pause();
      throw new Error("HTML media capture did not provide an audio track");
    }

    const sourceContext = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    const source = sourceContext.createMediaStreamSource(stream);
    const sourceAnalyser = sourceContext.createAnalyser();
    const renderGain = sourceContext.createGain();
    sourceAnalyser.fftSize = 512;
    renderGain.gain.value = 0.0001;
    source.connect(sourceAnalyser);
    sourceAnalyser.connect(renderGain);
    renderGain.connect(sourceContext.destination);
    await sourceContext.resume();
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return {
      stream,
      kind: "html_audio_capture",
      context: sourceContext,
      analyser: sourceAnalyser,
      samples: new Float32Array(sourceAnalyser.fftSize),
      element: audio,
    };
  };

  const createSyntheticAudioStream = async () => {
    const sourceContext = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    const oscillator = sourceContext.createOscillator();
    const sourceGain = sourceContext.createGain();
    const sourceAnalyser = sourceContext.createAnalyser();
    const renderGain = sourceContext.createGain();
    const destination = sourceContext.createMediaStreamDestination();
    const frequency = 420 + peerId.charCodeAt(0) * 2;
    oscillator.frequency.value = frequency;
    sourceGain.gain.value = 0.18;
    sourceAnalyser.fftSize = 512;
    renderGain.gain.value = 0.0001;
    oscillator.connect(sourceGain);
    sourceGain.connect(destination);
    sourceGain.connect(sourceAnalyser);
    sourceAnalyser.connect(renderGain);
    renderGain.connect(sourceContext.destination);
    oscillator.start();
    await sourceContext.resume();
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    return {
      stream: destination.stream,
      kind: "webaudio_oscillator",
      context: sourceContext,
      analyser: sourceAnalyser,
      samples: new Float32Array(sourceAnalyser.fftSize),
    };
  };
  let syntheticSource;
  try {
    syntheticSource = await createCapturedMediaAudioStream();
  } catch {
    try {
      syntheticSource = await createSyntheticAudioStream();
    } catch {
      syntheticSource = undefined;
    }
  }
  const localStream =
    syntheticSource?.stream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    }));
  const captureKind = syntheticSource?.kind ?? "fake_microphone_wav";
  const localTrack = localStream.getAudioTracks()[0];
  if (!localTrack) throw new Error("Fake microphone did not provide an audio track");
  let currentPhase = "initial";
  let reportTimer;

  const sendSignal = (targetPeerId, payload) => {
    ipcRenderer.send(channel, {
      type: "signal",
      sourcePeerId: peerId,
      targetPeerId,
      payload,
    });
  };

  const ensurePeer = async (targetPeerId, shouldOffer = false) => {
    const existing = peerConnections.get(targetPeerId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
    peerConnections.set(targetPeerId, connection);
    inboundTracks.delete(targetPeerId);
    connection.addTrack(localTrack, localStream);
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(targetPeerId, { type: "ice", candidate: event.candidate.toJSON() });
      }
    };
    connection.ontrack = (event) => {
      if (event.track.kind !== "audio") return;
      inboundTracks.set(targetPeerId, event.track);
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      const previous = playbackNodes.get(targetPeerId);
      previous?.source.disconnect();
      previous?.analyser.disconnect();
      previous?.element.remove();
      const element = document.createElement("audio");
      element.autoplay = true;
      element.muted = true;
      element.srcObject = stream;
      document.body.append(element);
      void element.play();
      const source = playbackContext.createMediaStreamSource(stream);
      const analyser = playbackContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(silentPlaybackGain);
      playbackNodes.set(targetPeerId, {
        source,
        analyser,
        samples: new Float32Array(analyser.fftSize),
        element,
      });
      void playbackContext.resume();
    };
    if (shouldOffer) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      sendSignal(targetPeerId, {
        type: "sdp",
        description: {
          type: connection.localDescription.type,
          sdp: connection.localDescription.sdp,
        },
      });
    }
    return connection;
  };

  const handleSignal = async ({ sourcePeerId, payload }) => {
    const connection = await ensurePeer(sourcePeerId, false);
    if (payload.type === "sdp") {
      await connection.setRemoteDescription(payload.description);
      const pending = pendingIceCandidates.get(sourcePeerId) ?? [];
      pendingIceCandidates.delete(sourcePeerId);
      for (const candidate of pending) {
        await connection.addIceCandidate(candidate);
      }
      if (payload.description.type === "offer") {
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendSignal(sourcePeerId, {
          type: "sdp",
          description: {
            type: connection.localDescription.type,
            sdp: connection.localDescription.sdp,
          },
        });
      }
      return;
    }
    if (payload.type === "ice") {
      if (!connection.remoteDescription) {
        const pending = pendingIceCandidates.get(sourcePeerId) ?? [];
        pending.push(payload.candidate);
        pendingIceCandidates.set(sourcePeerId, pending);
        return;
      }
      await connection.addIceCandidate(payload.candidate);
    }
  };

  const collectFlowingPeers = async () => {
    const flowing = [];
    const diagnostics = {};
    let captureLevel = 0;
    if (syntheticSource) {
      syntheticSource.analyser.getFloatTimeDomainData(syntheticSource.samples);
      let captureEnergy = 0;
      for (const sample of syntheticSource.samples) captureEnergy += sample * sample;
      captureLevel = Math.sqrt(captureEnergy / Math.max(1, syntheticSource.samples.length));
    }
    for (const [targetPeerId, connection] of peerConnections) {
      let inboundBytes = 0;
      let inboundPackets = 0;
      let inboundAudioEnergy = 0;
      let inboundSamplesDuration = 0;
      let inboundAudioLevel = 0;
      const stats = await connection.getStats();
      stats.forEach((report) => {
        if (
          report.type === "inbound-rtp" &&
          report.kind === "audio" &&
          !report.isRemote
        ) {
          inboundBytes += Number(report.bytesReceived ?? 0);
          inboundPackets += Number(report.packetsReceived ?? 0);
          inboundAudioEnergy += Number(report.totalAudioEnergy ?? 0);
          inboundSamplesDuration += Number(report.totalSamplesDuration ?? 0);
          inboundAudioLevel = Math.max(inboundAudioLevel, Number(report.audioLevel ?? 0));
        }
      });
      const inboundTrack = inboundTracks.get(targetPeerId);
      const hasTrack = Boolean(inboundTrack);
      const playback = playbackNodes.get(targetPeerId);
      let decodedLevel = 0;
      if (playback) {
        playback.analyser.getFloatTimeDomainData(playback.samples);
        let energy = 0;
        for (const sample of playback.samples) energy += sample * sample;
        decodedLevel = Math.sqrt(energy / Math.max(1, playback.samples.length));
      }
      const hasDecodedAudio =
        decodedLevel > 0.001 ||
        inboundAudioLevel > 0.001 ||
        (inboundAudioEnergy > 0.00001 && inboundSamplesDuration > 0.1);
      const isFlowing =
        hasTrack && inboundBytes > 1_500 && inboundPackets > 8 && hasDecodedAudio;
      diagnostics[targetPeerId] = {
        connectionState: connection.connectionState,
        iceConnectionState: connection.iceConnectionState,
        hasTrack,
        trackMuted: inboundTrack?.muted ?? true,
        trackEnabled: inboundTrack?.enabled ?? false,
        trackReadyState: inboundTrack?.readyState ?? "missing",
        inboundBytes,
        inboundPackets,
        inboundAudioEnergy,
        inboundSamplesDuration,
        inboundAudioLevel,
        decodedLevel,
        hasDecodedAudio,
        playbackContextState: playbackContext.state,
        captureKind,
        captureLevel,
        captureContextState: syntheticSource?.context.state ?? "microphone",
        captureTrackMuted: localTrack.muted,
        captureTrackReadyState: localTrack.readyState,
      };
      if (isFlowing) flowing.push(targetPeerId);
    }
    return { flowing, diagnostics };
  };

  const startReporting = () => {
    if (reportTimer) clearInterval(reportTimer);
    reportTimer = setInterval(async () => {
      const { flowing, diagnostics } = await collectFlowingPeers();
      ipcRenderer.send(channel, {
        type: "report",
        peerId,
        phase: currentPhase,
        flowing,
        diagnostics,
      });
    }, 300);
  };

  ipcRenderer.on(channel, async (_event, message) => {
    try {
      if (message.type === "peer-list") {
        for (const targetPeerId of message.peerIds) {
          if (targetPeerId === peerId) continue;
          await ensurePeer(targetPeerId, peerId < targetPeerId);
        }
        startReporting();
        return;
      }
      if (message.type === "signal") {
        await handleSignal(message);
        return;
      }
      if (message.type === "reset-pair" && message.peerIds.includes(peerId)) {
        const targetPeerId = message.peerIds.find((id) => id !== peerId);
        const previous = peerConnections.get(targetPeerId);
        previous?.close();
        peerConnections.delete(targetPeerId);
        inboundTracks.delete(targetPeerId);
        pendingIceCandidates.delete(targetPeerId);
        const previousPlayback = playbackNodes.get(targetPeerId);
        previousPlayback?.source.disconnect();
        previousPlayback?.analyser.disconnect();
        previousPlayback?.element.remove();
        playbackNodes.delete(targetPeerId);
        currentPhase = "recovery";
        await new Promise((resolve) => setTimeout(resolve, peerId < targetPeerId ? 120 : 40));
        await ensurePeer(targetPeerId, peerId < targetPeerId);
      }
    } catch (error) {
      ipcRenderer.send(channel, {
        type: "renderer-error",
        peerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  ipcRenderer.send(channel, { type: "ready", peerId });
  })().catch((error) => {
    ipcRenderer.send(channel, {
      type: "renderer-error",
      peerId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
`;

const renderHtml = () =>
  `<!doctype html><html><body><script>${rendererScript}</script></body></html>`;

const peerHasFullMesh = (peerId, report) =>
  report &&
  PEER_IDS.filter((candidate) => candidate !== peerId).every((candidate) =>
    report.flowing.includes(candidate),
  );

const summarize = (ok, extra = {}) => {
  const directedFlows = [];
  for (const peerId of PEER_IDS) {
    const report = reports.get(peerId);
    for (const targetPeerId of report?.flowing ?? []) {
      directedFlows.push(`${targetPeerId}->${peerId}`);
    }
  }
  return {
    ok,
    expectedPeerCount: PEER_IDS.length,
    expectedDirectedAudioFlows: PEER_IDS.length * (PEER_IDS.length - 1),
    observedDirectedAudioFlows: new Set(directedFlows).size,
    lateJoinPeer: "E",
    recoveredPair: ["A", "E"],
    phase,
    peers: Object.fromEntries(reports),
    ...extra,
  };
};

const finish = (ok, extra) => {
  if (isFinished) return;
  isFinished = true;
  clearTimeout(phaseTimer);
  console.log(JSON.stringify(summarize(ok, extra), null, 2));
  for (const window of windows.values()) {
    if (!window.isDestroyed()) window.destroy();
  }
  try {
    fs.unlinkSync(FAKE_AUDIO_PATH);
  } catch {
    // The operating system may still be releasing the fake capture file.
  }
  try {
    fs.unlinkSync(TEST_HTML_PATH);
  } catch {
    // The operating system may still be releasing the temporary page.
  }
  app.exit(ok ? 0 : 1);
};

const scheduleTimeout = (timeoutMs, reason) => {
  clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => finish(false, { error: reason }), timeoutMs);
};

const broadcastPeerList = () => {
  const peerIds = [...windows.keys()];
  for (const window of windows.values()) {
    window.webContents.send(CHANNEL, { type: "peer-list", peerIds });
  }
};

const maybeAdvance = () => {
  if (phase === "initial") {
    if (!PEER_IDS.every((peerId) => peerHasFullMesh(peerId, reports.get(peerId)))) return;
    phase = "recovery";
    reports.delete("A");
    reports.delete("E");
    windows.get("A").webContents.send(CHANNEL, {
      type: "reset-pair",
      peerIds: ["A", "E"],
    });
    windows.get("E").webContents.send(CHANNEL, {
      type: "reset-pair",
      peerIds: ["A", "E"],
    });
    scheduleTimeout(RECOVERY_TIMEOUT_MS, "A/E media recovery timed out");
    return;
  }

  const reportA = reports.get("A");
  const reportE = reports.get("E");
  const aRecovered = reportA?.phase === "recovery" && reportA.flowing.includes("E");
  const eRecovered = reportE?.phase === "recovery" && reportE.flowing.includes("A");
  if (aRecovered && eRecovered) finish(true, { recoveryVerified: true });
};

ipcMain.on(CHANNEL, (_event, message) => {
  if (message.type === "ready") {
    readyPeers.add(message.peerId);
    if (readyPeers.size === PEER_IDS.length) broadcastPeerList();
    return;
  }
  if (message.type === "signal") {
    const target = windows.get(message.targetPeerId);
    target?.webContents.send(CHANNEL, message);
    return;
  }
  if (message.type === "report") {
    reports.set(message.peerId, message);
    maybeAdvance();
    return;
  }
  if (message.type === "renderer-error") {
    finish(false, { error: `${message.peerId}: ${message.error}` });
  }
});

app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "media");
    });
    fs.writeFileSync(TEST_HTML_PATH, renderHtml(), "utf8");
    scheduleTimeout(INITIAL_TIMEOUT_MS, "Five-peer media full mesh timed out");
    for (const peerId of PEER_IDS) {
      const window = new BrowserWindow({
        // A fully hidden Chromium window does not reliably pull decoded audio.
        // Keep it rendered off-screen and transparent so this exercises the
        // same playback path as the visible desktop application.
        show: true,
        opacity: 0,
        x: -32_000,
        y: -32_000,
        width: 80,
        height: 80,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          backgroundThrottling: false,
        },
      });
      windows.set(peerId, window);
      await window.loadFile(TEST_HTML_PATH, { hash: `peerId=${peerId}` });
      if (peerId === "D") {
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    }
    if (readyPeers.size === PEER_IDS.length) broadcastPeerList();
  })
  .catch((error) =>
    finish(false, { error: error instanceof Error ? error.message : String(error) }),
  );
