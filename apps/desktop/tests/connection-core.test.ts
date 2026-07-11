import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("webrtc prefers domestic stun and buffers early ICE candidates", () => {
  const source = read("packages/webrtc/src/createPeer.ts");

  assert.equal(source.includes("stun:stun.qq.com:3478"), true);
  assert.equal(source.includes("stun:stun.miwifi.com:3478"), true);
  assert.equal(source.includes("stun:stun.chat.bilibili.com:3478"), true);
  assert.equal(source.includes("pendingIceCandidates"), true);
  assert.equal(source.includes("flushPendingIceCandidates"), true);
});

test("room client marks webrtc ready from connection state instead of remote stream", () => {
  const source = read("apps/desktop/src/renderer/src/features/room/roomClient.ts");
  const relay = read("apps/desktop/src/renderer/src/features/room/signalingAudioRelay.ts");

  assert.equal(source.includes('if (state === "connected")'), true);
  assert.equal(source.includes("this.webrtcReadyPeerIds.add(targetPeerId)"), true);
  assert.equal(source.includes('this.audioRelay?.markPeerPath(targetPeerId, "webrtc", "webrtc_connected")'), true);
  assert.equal(source.includes('state === "closed"'), true);
  assert.equal(relay.includes("RELAY_SAMPLE_RATE = 16_000"), true);
  assert.equal(relay.includes("MAX_PACKET_AGE_MS = 3_000"), true);
  assert.equal(relay.includes("MAX_QUEUE_DURATION_MS = 700"), true);
  assert.equal(relay.includes("MAX_QUEUE_CHUNKS = 36"), true);
  assert.equal(relay.includes('codec: "mulaw"'), true);
  assert.equal(relay.includes('message.codec === "mulaw"'), true);
  assert.equal(relay.includes("new AudioWorkletNode"), true);
  assert.equal(relay.includes("script_processor_fallback_started"), true);
  assert.equal(relay.includes("droppedExpiredChunks"), true);
  assert.equal(relay.includes("serverClockOffsetMs"), true);
  assert.equal(relay.includes("audioStreamEpoch"), true);
  assert.equal(relay.includes("audio_resync_request"), true);
  assert.equal(relay.includes("this.context.currentTime"), true);
});

test("room flow is fixed-channel only", () => {
  const client = read("apps/desktop/src/renderer/src/features/room/roomClient.ts");
  const hook = read("apps/desktop/src/renderer/src/hooks/useRoomState.ts");
  const protocol = read("packages/signaling/src/protocol.ts");

  assert.equal(client.includes('type: "join_channel"'), true);
  assert.equal(client.includes('type: "leave_channel"'), true);
  assert.equal(client.includes("joinChannelSent"), true);
  assert.equal(client.includes("join_room"), false);
  assert.equal(hook.includes("connectToFixedChannel"), true);
  assert.equal(hook.includes("startHost"), false);
  assert.equal(protocol.includes("JoinChannelMessage"), true);
  assert.equal(protocol.includes("JoinRoomMessage"), false);
});

test("relay status checks both health endpoint and websocket", () => {
  const relayStatus = read("apps/desktop/src/main/relay-status.ts");

  assert.equal(relayStatus.includes('healthUrl.pathname = "/health"'), true);
  assert.equal(relayStatus.includes("probeHealth(normalizedUrl)"), true);
  assert.equal(relayStatus.includes("probeWebSocket(normalizedUrl)"), true);
  assert.equal(relayStatus.includes("const isReachable = isWebSocketReachable"), true);
});

test("room client preserves peers and self-heals signaling and media indefinitely", () => {
  const source = read("apps/desktop/src/renderer/src/features/room/roomClient.ts");
  const hook = read("apps/desktop/src/renderer/src/hooks/useRoomState.ts");

  assert.equal(source.includes("MAX_RECONNECT_ATTEMPTS"), false);
  assert.equal(source.includes('type: "peer_restart_request"'), true);
  assert.equal(source.includes("schedulePeerRecovery"), true);
  assert.equal(source.includes("connection_timeout"), true);
  assert.equal(source.includes("DEFAULT_ICE_SERVERS"), true);
  assert.equal(source.includes("[...DEFAULT_ICE_SERVERS, ...relayIceServers]"), true);
  assert.equal(source.includes("Ignored stale room snapshot"), true);
  assert.equal(source.includes("snapshot.revision <= this.lastSnapshotRevision"), true);
  assert.equal(source.includes("this.clearPeers();\n      this.reconnect();"), false);
  assert.equal(hook.includes("cleanupPreviousSession"), true);
  assert.equal(hook.includes("peerId: sharedPeerId"), false);
});

test("audio backpressure drops realtime frames instead of queueing stale audio", () => {
  const bridge = read("apps/desktop/src/main/signaling-client.ts");
  const server = read("packages/signaling/src/server.ts");
  assert.equal(bridge.includes("bufferedAmount >= 512 * 1024"), true);
  assert.equal(bridge.includes("droppedByBackpressure"), true);
  assert.equal(bridge.includes("maxBufferedAmount"), true);
  assert.equal(server.includes("MAX_REALTIME_SOCKET_BUFFER_BYTES"), true);
  assert.equal(server.includes("dropping stale realtime payload for slow client"), true);
  assert.equal(server.includes('payload.type === "audio_chunk" || payload.type === "screen_frame"'), true);
});

test("room joining uses acknowledgement and snapshot recovery without logging raw signaling data", () => {
  const client = read("apps/desktop/src/renderer/src/features/room/roomClient.ts");
  const hook = read("apps/desktop/src/renderer/src/hooks/useRoomState.ts");
  const diagnostics = read("apps/desktop/src/main/diagnostics.ts");

  assert.equal(client.includes('case "join_ack"'), true);
  assert.equal(client.includes('type: "request_snapshot"'), true);
  assert.equal(client.includes("RoomConnectionState.WaitingSnapshot"), true);
  assert.equal(client.includes('new Error(this.wsOpened ? "join_ack_timeout"'), true);
  assert.equal(hook.includes("summarizeSignalingEvent"), true);
  assert.equal(hook.includes("...payload,"), false);
  assert.equal(diagnostics.includes("MAX_LOG_FILE_BYTES"), true);
  assert.equal(diagnostics.includes("EXPORT_LOG_TAIL_BYTES"), true);
  assert.equal(diagnostics.includes('"log-stats.json"'), true);
});

test("windows executable and shortcut use cache-busting v3 icons", () => {
  const builder = read("apps/desktop/electron-builder.yml");
  const installer = read("apps/desktop/build/installer.nsh");

  assert.equal(builder.includes("icon: shanghao-icon-v3.ico"), true);
  assert.equal(builder.includes("signAndEditExecutable: false"), true);
  assert.equal(builder.includes("afterPack: ../../scripts/after-pack.cjs"), true);
  assert.equal(read("scripts/after-pack.cjs").includes("shanghao-icon-v3.ico"), true);
  assert.equal(installer.includes("shanghao-shortcut-v3.ico"), true);
});

test("llm chat accepts slash commands and joins proxy paths safely", () => {
  const rendererLlm = read("apps/desktop/src/renderer/src/features/chat/llmService.ts");
  const mainLlm = read("apps/desktop/src/main/llm-service.ts");
  const signaling = read("packages/signaling/src/server.ts");

  assert.equal(rendererLlm.includes("/(?:ai|llm)"), true);
  assert.equal(rendererLlm.includes("你想问什么呀？"), true);
  assert.equal(mainLlm.includes("joinHttpPath(httpUrl, \"/llm/chat\")"), true);
  assert.equal(mainLlm.includes("replace(/\\/+$/, \"\")"), true);
  assert.equal(signaling.includes("normalizeRequestPathname"), true);
});

test("main process guards ipc pushes after windows are destroyed", () => {
  const ipc = read("apps/desktop/src/main/ipc.ts");
  const shortcuts = read("apps/desktop/src/main/shortcuts.ts");
  const overlay = read("apps/desktop/src/main/overlay-window.ts");
  const safeSend = read("apps/desktop/src/main/safe-web-contents.ts");

  assert.equal(ipc.includes("sendToWindow(getMainWindow()"), true);
  assert.equal(shortcuts.includes("sendToWindow(this.windowProvider()"), true);
  assert.equal(overlay.includes("sendToWindow(window"), true);
  assert.equal(safeSend.includes("window.webContents.isDestroyed()"), true);
  assert.equal(safeSend.includes("destroyed"), true);
});

test("installer and updater quit paths clean background surfaces", () => {
  const main = read("apps/desktop/src/main/index.ts");
  const updates = read("apps/desktop/src/main/updates.ts");
  const installer = read("apps/desktop/build/installer.nsh");

  assert.equal(main.includes("QUIT_FOR_INSTALL_ARG"), true);
  assert.equal(main.includes("installer-second-instance"), true);
  assert.equal(main.includes("prepareForQuit"), true);
  assert.equal(main.includes("tray.destroy()"), true);
  assert.equal(main.includes("overlayController?.close()"), true);
  assert.equal(main.includes("shortcutsController?.dispose()"), true);
  assert.equal(updates.includes("before-quit-for-update"), true);
  assert.equal(updates.includes("beforeInstall?.()"), true);
  assert.equal(updates.includes("autoUpdater.quitAndInstall(true, true)"), true);
  assert.equal(updates.includes("setTimeout(() => app.exit(0), 4_000)"), true);
  assert.equal(installer.includes("--shanghao-quit-for-install"), true);
  assert.equal(installer.includes('${nsProcess::FindProcess} "${PROCESS_NAME}" $R8'), true);
  assert.equal(installer.includes("Exec '\"${EXECUTABLE_PATH}\" --shanghao-quit-for-install'"), true);
  assert.equal(installer.includes("nsExec::ExecToLog '\"$INSTDIR\\ShangHao.exe\" --shanghao-quit-for-install'"), false);
  assert.equal(installer.includes("migrateBrokenLegacyInstaller"), true);
  assert.equal(installer.includes("!macro customRemoveFiles"), true);
  assert.equal(installer.includes('SetOutPath "$TEMP"'), true);
  assert.equal(installer.includes('Abort "旧版上号程序文件仍被占用。"'), true);
  assert.equal(installer.includes('$R7 == "0.1.45"'), true);
  assert.equal(installer.includes('$R7 == "0.1.48"'), true);
  assert.equal(installer.includes('DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}"'), true);
  assert.equal(installer.includes("taskkill.exe"), true);
});

test("room invite copies only the server address with a visible success toast", () => {
  const hook = read("apps/desktop/src/renderer/src/hooks/useRoomState.ts");
  const roomPage = read("apps/desktop/src/renderer/src/pages/RoomPage.tsx");

  assert.equal(hook.includes("buildChannelInviteText"), true);
  assert.equal(hook.includes("上号频道码："), false);
  assert.equal(hook.includes("服务器地址："), false);
  assert.equal(hook.includes("服务器地址已复制"), true);
  assert.equal(hook.includes('playUiSound("copy-success")'), true);
  assert.equal(hook.includes("Copied fixed channel invite"), true);
  assert.equal(hook.includes("desktopApi.clipboard.writeText"), true);
  assert.equal(hook.includes("navigator.clipboard.writeText"), false);
  assert.equal(roomPage.includes("copyInviteLink"), true);
  assert.equal(roomPage.includes("navigator.clipboard.writeText(`上号服务器"), false);
});

test("desktop clipboard writes go through the electron main process", () => {
  const ipcConstants = read("packages/shared/src/constants/ipc.ts");
  const ipcTypes = read("packages/shared/src/types/ipc.types.ts");
  const preload = read("apps/desktop/src/preload/index.ts");
  const mainIpc = read("apps/desktop/src/main/ipc.ts");
  const copyField = read("apps/desktop/src/renderer/src/components/base/CopyField.tsx");

  assert.equal(ipcConstants.includes("clipboard:write-text"), true);
  assert.equal(ipcTypes.includes("clipboard: {"), true);
  assert.equal(preload.includes("IPC_CHANNELS.clipboard.writeText"), true);
  assert.equal(mainIpc.includes("clipboard.writeText(text)"), true);
  assert.equal(copyField.includes("desktopApi.clipboard"), true);
  assert.equal(copyField.includes("navigator.clipboard"), false);
});

test("global push-to-talk listens for keydown and keyup outside the app", () => {
  const shortcuts = read("apps/desktop/src/main/shortcuts.ts");
  const transport = read(
    "apps/desktop/src/renderer/src/hooks/useLocalAudioTransport.ts",
  );
  assert.equal(shortcuts.includes('uIOhook.on("keydown"'), true);
  assert.equal(shortcuts.includes('uIOhook.on("keyup"'), true);
  assert.equal(shortcuts.includes("pushToTalkState"), true);
  assert.equal(transport.includes("onPushToTalkState"), true);
});

test("native notifications and recording markers use main process IPC", () => {
  const ipc = read("apps/desktop/src/main/ipc.ts");
  const room = read("apps/desktop/src/renderer/src/pages/RoomPage.tsx");
  assert.equal(ipc.includes("Notification.isSupported"), true);
  assert.equal(ipc.includes("recording.saveMarkers"), true);
  assert.equal(room.includes("onRecordingMarkerTriggered"), true);
});
