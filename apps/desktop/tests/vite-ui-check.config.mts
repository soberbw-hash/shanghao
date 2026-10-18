import config from "../vite.config.mts";

// A build or main-process watcher must not reload the page halfway through an
// animation assertion. Keep this server independent of the user's dev session.
export default {
  ...config,
  server: {
    ...config.server,
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
    hmr: false,
    watch: null,
  },
};
