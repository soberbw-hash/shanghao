/* eslint-disable @typescript-eslint/no-require-imports */
/* global console, require */

const { app, BrowserWindow } = require("electron");
const http = require("node:http");

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:;";

let server;

const closeServer = () =>
  new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });

const fail = async (error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  await closeServer();
  app.exit(1);
};

app
  .whenReady()
  .then(async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Security-Policy": CSP,
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(
        "<!doctype html><html><head><title>audio-worklet-smoke</title></head><body></body></html>",
      );
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to start the local AudioWorklet test server.");
    }

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      },
    });

    try {
      await window.loadURL(`http://127.0.0.1:${address.port}/`);

      const result = await window.webContents.executeJavaScript(`
      (async () => {
        const context = new AudioContext({ sampleRate: 48000 });
        if (!context.audioWorklet) {
          await context.close();
          return { ok: false, error: "audio_worklet_unavailable" };
        }
        const source = [
          "class ShangHaoSmokeProcessor extends AudioWorkletProcessor {",
          "  process(inputs, outputs) {",
          "    const input = inputs[0]?.[0];",
          "    const output = outputs[0]?.[0];",
          "    if (input && output) output.set(input);",
          "    return true;",
          "  }",
          "}",
          "registerProcessor('shanghao-smoke-processor', ShangHaoSmokeProcessor);",
        ].join("\\n");
        const moduleUrl = URL.createObjectURL(
          new Blob([source], { type: "application/javascript" }),
        );
        try {
          await context.audioWorklet.addModule(moduleUrl);
          const node = new AudioWorkletNode(context, "shanghao-smoke-processor");
          node.disconnect();
          return { ok: true, sampleRate: context.sampleRate };
        } finally {
          URL.revokeObjectURL(moduleUrl);
          await context.close();
        }
      })()
    `);

      console.log(JSON.stringify(result));
      window.destroy();
      await closeServer();
      app.exit(result?.ok === true && result?.sampleRate === 48000 ? 0 : 1);
    } catch (error) {
      window.destroy();
      await fail(error);
    }
  })
  .catch(fail);
