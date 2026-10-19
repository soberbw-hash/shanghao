/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, setTimeout, clearTimeout, console */
const { app, Notification } = require("electron");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "notification-probe");
if (process.platform === "win32") app.setAppUserModelId("com.sober.shanghao");
app.on("window-all-closed", () => {});
const timeout = setTimeout(() => {
  console.log(JSON.stringify({ supported: Notification.isSupported(), result: "timeout" }));
  app.exit(1);
}, 8000);
let notification;
let showed = false;
let finished = false;
app
  .whenReady()
  .then(() => {
    if (process.platform !== "win32") {
      clearTimeout(timeout);
      console.log(
        JSON.stringify({ result: "skipped", reason: "Windows native notification probe" }),
      );
      app.exit(0);
      return;
    }
    if (!Notification.isSupported()) {
      clearTimeout(timeout);
      console.log(JSON.stringify({ supported: false, result: "unsupported" }));
      app.exit(1);
      return;
    }
    notification = new Notification({
      title: "上号通知测试",
      body: "正在检查消息与好友上线通知。",
      silent: true,
    });
    const finish = (result, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      console.log(JSON.stringify({ supported: true, result, error }));
      setTimeout(() => {
        notification.close();
        app.exit(showed && result !== "failed" ? 0 : 1);
      }, 800);
    };
    // Windows can emit show before reporting asynchronous delivery rejection.
    notification.once("show", () => {
      showed = true;
      setTimeout(() => finish("shown-without-native-rejection"), 2000);
    });
    notification.once("failed", (_event, error) => finish("failed", error));
    notification.show();
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
