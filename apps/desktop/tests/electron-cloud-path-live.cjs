/* global require, console, setTimeout, clearTimeout, AbortSignal */
/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only account recovery. Synthetic audio only; never print or rewrite account/provider keys.
const { app, net } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path");
const { configureIsolatedProfile } = require("./electron-isolated-profile.cjs");
const appData = app.getPath("appData");
configureIsolatedProfile(app, "cloud-path-live");
const deadline = setTimeout(() => app.exit(1), 210000);
let probeStage = "load";
app
  .whenReady()
  .then(async () => {
    const {
      BuiltInAiClient,
      recoverProviderPlaintext,
      CloudBaseAccountClient,
      AccountDesktopService,
      RoomChronicleProcessor,
      RoomChronicleSessions,
      transcribeWithRemoteProvider,
      createEmptyVoiceMemoryRecord,
      saveRecordingParticipantTrack,
      finalizeRecordingParticipantTracks,
    } = require(path.resolve("../../artifacts/cloud-path-probe.cjs"));
    probeStage = "status";
    const origin = "https://47.94.230.179";
    const fetcher = (url, options) => net.fetch(String(url), options);
    const statusResponse = await fetcher(origin + "/api/ai/status", {
      signal: AbortSignal.timeout(10000),
    });
    const status = await statusResponse.json();
    const result = {
      checkedAt: new Date().toISOString(),
      statusHttp: statusResponse.status,
      transcriptionConfigured: status.transcriptionConfigured === true,
      textConfigured: status.textConfigured === true,
    };
    const anonymous = await fetcher(origin + "/api/ai/transcriptions", {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: new Uint8Array([0]).buffer,
      signal: AbortSignal.timeout(10000),
    });
    result.anonymousStatus = anonymous.status;
    await anonymous.body?.cancel();
    probeStage = "read-account";
    const candidates = [];
    for (const profile of ["shanghao", "shanghao-desktop"]) {
      try {
        const encrypted = await fs.readFile(path.join(appData, profile, "account-session.bin"));
        const clear = await recoverProviderPlaintext(encrypted, appData);
        const session = clear && JSON.parse(clear);
        if (session?.accessToken) candidates.push(session);
      } catch {
        /* No secret details in output. */
      }
    }
    candidates.sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0));
    result.readOnlySessionFound = candidates.length > 0;
    let session = candidates[0];
    let account;
    let desktopAccount;
    probeStage = "restore-account";
    if (session?.provider === "cloudbase") {
      try {
        const configuration = await (
          await fetcher(origin + "/api/account/status", { signal: AbortSignal.timeout(10000) })
        ).json();
        const auth = configuration.auth;
        let publishableKey = auth?.cloudbasePublishableKey;
        for (const file of [
          "src/renderer/.env.local",
          "src/renderer/.env",
          ".env.local",
          ".env",
          "../../.env.local",
          "../../.env",
        ]) {
          if (publishableKey) break;
          try {
            const source = await fs.readFile(path.resolve(file), "utf8");
            publishableKey = /^(?:VITE_)?CLOUDBASE_PUBLISHABLE_KEY\s*=\s*["']?([^\r\n"']+)/m
              .exec(source)?.[1]
              ?.trim();
          } catch {
            /* Read only the same public client configuration used by the desktop build. */
          }
        }
        result.cloudbasePublicConfiguration = !!auth?.cloudbaseEnvId && !!publishableKey;
        account = new CloudBaseAccountClient({
          envId: auth?.cloudbaseEnvId ?? "",
          region: auth?.cloudbaseRegion || "ap-shanghai",
          publishableKey: publishableKey ?? "",
        });
        session = (await account.restore(session)).session;
        result.accountRestoredInIsolatedContext = true;
      } catch (error) {
        result.accountRestoreError = /^account_[a-z_]+$/.test(error.message)
          ? error.message
          : error.name;
      }
      if (
        !result.accountRestoredInIsolatedContext &&
        account &&
        result.cloudbasePublicConfiguration
      ) {
        for (const profile of ["shanghao", "shanghao-desktop"]) {
          try {
            const clear = await recoverProviderPlaintext(
              await fs.readFile(path.join(appData, profile, "account-login.bin")),
              appData,
            );
            const login = clear && JSON.parse(clear);
            if (!login?.identifier || !login?.password) continue;
            if (!login.profile?.userId) continue;
            let writes = 0;
            desktopAccount = new AccountDesktopService(
              {
                readRememberedLogin: async () => login,
                write: async () => {
                  writes++;
                },
              },
              () => origin.replace("https:", "wss:"),
              fetcher,
            );
            Object.assign(desktopAccount, {
              session,
              accountProvider: "cloudbase",
              cloudbase: account,
              cloudbaseNeedsRestore: true,
              snapshot: {
                status: "signed_in",
                configured: true,
                guestAllowed: false,
                profile: login.profile,
              },
            });
            const token = await desktopAccount.getFreshAccessToken();
            result.productionAutomaticLoginRecovery =
              !!token && desktopAccount.getSnapshot().status === "signed_in";
            result.recoveryWritesMemoryOnly = writes > 0;
            result.rememberedLoginVerifiedInMemory = result.productionAutomaticLoginRecovery;
            break;
          } catch (error) {
            result.rememberedLoginError = /^account_[a-z_]+$/.test(error.message)
              ? error.message
              : error.name;
          }
        }
      }
    }
    probeStage = "transcription";
    if (session) {
      const client = new BuiltInAiClient(
        () => origin.replace("https:", "wss:"),
        async (force) => {
          if (desktopAccount) return desktopAccount.getFreshAccessToken(force);
          if (force && account) session = (await account.refresh()).session;
          return session.accessToken;
        },
        fetcher,
      );
      try {
        const audio = path.resolve("../../artifacts/cloud-path-synthetic.wav");
        const response = await client.transcribe(audio, 8000, AbortSignal.timeout(100000));
        result.transcriptionCompleted = true;
        result.transcriptionNonempty = response.text.trim().length > 0;
      } catch (error) {
        result.transcriptionError = /^cloud_asr_[a-z_0-9]+$|^account_[a-z_]+$/.test(error.message)
          ? error.message
          : error.name;
      }
      try {
        const text = await client.organize(
          "仅处理以下合成测试内容：小明说约好晚上八点开黑，小华说记得先吃饭。返回一个简短 JSON 摘要。",
          AbortSignal.timeout(60000),
        );
        result.summaryCompleted = text.trim().length > 0;
      } catch (error) {
        result.summaryError = /^cloud_asr_[a-z_0-9]+$|^cloud_ai_[a-z_]+$|^account_[a-z_]+$/.test(
          error.message,
        )
          ? error.message
          : error.name;
      }
      // Exercise the production room processor using real cloud APIs, synthetic audio,
      // and private in-memory room state. No production room is joined or changed.
      probeStage = "recording-pipeline";
      try {
        const filePath = path.resolve("../../artifacts/cloud-path-synthetic.wav");
        const audio = await fs.readFile(filePath);
        const syntheticId = `synthetic-cloud-${Date.now()}`;
        const roomId = "synthetic-only";
        for (const userId of ["synthetic-a", "synthetic-b"]) {
          const saved = await saveRecordingParticipantTrack({
            sessionId: syntheticId,
            buffer: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
            sourceMimeType: "audio/wav",
            userId,
            speakerId: userId,
            displayNameSnapshot: userId,
            trackId: userId,
            roomId,
            startMs: 0,
            endMs: 7000,
          });
          if (!saved.ok) throw Error("synthetic_track_save_failed");
        }
        await finalizeRecordingParticipantTracks({
          sessionId: syntheticId,
          recordingId: syntheticId,
          recordingFilePath: filePath,
        });
        let current = createEmptyVoiceMemoryRecord({ recordingId: syntheticId, filePath, roomId });
        let uploads = 0;
        const host = {
          provider: "cloud",
          signal: AbortSignal.timeout(100000),
          store: {
            status: async () => ({ cloudConfigured: true }),
            transcribe: async (file, duration, _provider, signal) => {
              uploads++;
              return client.transcribe(file, duration, signal);
            },
          },
          save: async (record) => {
            current = { ...record, updatedAt: new Date().toISOString() };
            return current;
          },
          updateDiagnostic: async (record) => record,
        };
        current = await transcribeWithRemoteProvider({ ...host, record: current });
        result.productionRecordingCompleted = current.phase === "ready" && current.progress === 100;
        result.independentSpeakersPreserved =
          new Set(current.transcript.map((part) => part.speakerId)).size === 2;
        result.sourcePartsCompleted = current.remoteTranscription?.parts.length === 2;
        const before = uploads;
        await transcribeWithRemoteProvider({ ...host, record: current });
        result.completedAudioNotUploadedAgain = uploads === before;
      } catch (error) {
        result.recordingPipelineError =
          /^cloud_asr_[a-z_0-9]+$|^account_[a-z_]+$|^ffmpeg_[a-z_]+$|^synthetic_[a-z_]+$/.test(
            error.message,
          )
            ? error.message
            : error.name;
      }
      probeStage = "room-pipeline";
      const sessions = new RoomChronicleSessions();
      const id = sessions.start("cloud-probe", "synthetic-member", ["synthetic-member"]);
      sessions.participate("cloud-probe", id, "synthetic-member", true);
      const processor = new RoomChronicleProcessor(
        sessions,
        {
          isConfigured: () => true,
          transcribe: async (_bytes, _mime, signal) => {
            const reply = await client.transcribe(
              path.resolve("../../artifacts/cloud-path-synthetic.webm"),
              8000,
              signal,
            );
            return { text: reply.text, modelName: "built-in" };
          },
        },
        {
          isConfigured: () => true,
          execute: (request) => client.organize(request.prompt, AbortSignal.timeout(60000)),
        },
        () => undefined,
        20,
      );
      try {
        const bytes = await fs.readFile(path.resolve("../../artifacts/cloud-path-synthetic.webm"));
        await processor.submit(
          {
            type: "chronicle_audio",
            roomId: "cloud-probe",
            sessionId: id,
            peerId: "synthetic-member",
            chunkId: "synthetic-once",
            startedAt: Date.now(),
            durationMs: 8000,
            mime: "audio/webm",
            data: bytes.toString("base64"),
          },
          "测试成员",
        );
        const until = Date.now() + 65000;
        while (!sessions.read("cloud-probe", id, "synthetic-member").length && Date.now() < until)
          await new Promise((resolve) => setTimeout(resolve, 100));
        result.productionRoomProcessorCompleted =
          sessions.read("cloud-probe", id, "synthetic-member").length > 0;
      } catch (error) {
        result.roomProcessorError =
          /^cloud_asr_[a-z_0-9]+$|^cloud_ai_[a-z_]+$|^account_[a-z_]+$/.test(error.message)
            ? error.message
            : error.name;
      } finally {
        processor.dispose();
      }
    }
    probeStage = "finish";
    desktopAccount?.dispose();
    await fs.writeFile(
      path.resolve("../../artifacts/cloud-path-live-20261101.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    if (
      !result.transcriptionCompleted ||
      !result.transcriptionNonempty ||
      !result.summaryCompleted ||
      !result.productionRoomProcessorCompleted ||
      !result.productionRecordingCompleted ||
      !result.independentSpeakersPreserved ||
      !result.sourcePartsCompleted ||
      !result.completedAudioNotUploadedAgain ||
      (result.accountRestoreError && !result.productionAutomaticLoginRecovery)
    )
      throw Error("cloud_path_incomplete");
  })
  .then(
    () => {
      clearTimeout(deadline);
      app.exit(0);
    },
    (error) => {
      console.error(
        JSON.stringify({
          probeFailed: true,
          errorName: error.name,
          probeStage,
          callsites: String(error.stack)
            .split("\n")
            .slice(1, 4)
            .map((line) => /([^\\/\s]+:\d+:\d+)\)?$/.exec(line)?.[1]),
        }),
      );
      clearTimeout(deadline);
      app.exit(1);
    },
  );
