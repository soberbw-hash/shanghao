/* eslint-disable @typescript-eslint/no-require-imports */
/* global clearTimeout, console, require, setTimeout */

const { app, BrowserWindow, ipcMain } = require("electron");

const PEER_IDS = ["A", "B", "C", "D", "E"];
const INITIAL_TIMEOUT_MS = 24_000;
const RECOVERY_TIMEOUT_MS = 12_000;
const CHANNEL = "five-peer-media";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

const windows = new Map();
const reports = new Map();
let phase = "initial";
let phaseTimer;
let isFinished = false;

const rendererScript = `
  const { ipcRenderer } = require("electron");
  const channel = ${JSON.stringify(CHANNEL)};
  const peerId = new URLSearchParams(location.hash.slice(1)).get("peerId");
  const peerConnections = new Map();
  const inboundTracks = new Map();
  const sourceContext = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  const oscillator = sourceContext.createOscillator();
  const sourceGain = sourceContext.createGain();
  const destination = sourceContext.createMediaStreamDestination();
  sourceGain.gain.value = 0.08;
  oscillator.frequency.value = 280 + peerId.charCodeAt(0) * 3;
  oscillator.connect(sourceGain);
  sourceGain.connect(destination);
  oscillator.start();
  void sourceContext.resume();

  const localTrack = destination.stream.getAudioTracks()[0];
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
    connection.addTrack(localTrack, destination.stream);
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(targetPeerId, { type: "ice", candidate: event.candidate.toJSON() });
      }
    };
    connection.ontrack = (event) => {
      if (event.track.kind !== "audio") return;
      inboundTracks.set(targetPeerId, event.track.id);
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      const audio = new Audio();
      audio.autoplay = true;
      audio.muted = true;
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
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
      await connection.addIceCandidate(payload.candidate);
    }
  };

  const collectFlowingPeers = async () => {
    const flowing = [];
    const diagnostics = {};
    for (const [targetPeerId, connection] of peerConnections) {
      let inboundBytes = 0;
      let inboundPackets = 0;
      const stats = await connection.getStats();
      stats.forEach((report) => {
        if (
          report.type === "inbound-rtp" &&
          report.kind === "audio" &&
          !report.isRemote
        ) {
          inboundBytes += Number(report.bytesReceived ?? 0);
          inboundPackets += Number(report.packetsReceived ?? 0);
        }
      });
      const hasTrack = inboundTracks.has(targetPeerId);
      const isFlowing = hasTrack && inboundBytes > 1_500 && inboundPackets > 8;
      diagnostics[targetPeerId] = {
        connectionState: connection.connectionState,
        iceConnectionState: connection.iceConnectionState,
        hasTrack,
        inboundBytes,
        inboundPackets,
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
    broadcastPeerList();
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
    scheduleTimeout(INITIAL_TIMEOUT_MS, "Five-peer media full mesh timed out");
    for (const peerId of PEER_IDS) {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          backgroundThrottling: false,
        },
      });
      windows.set(peerId, window);
      const html = renderHtml();
      await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}#peerId=${peerId}`,
      );
      if (peerId === "D") {
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    }
    broadcastPeerList();
  })
  .catch((error) => finish(false, { error: error instanceof Error ? error.message : String(error) }));
