// Electron's default loader does not guarantee require.main === the loaded entry.
require("./desktop.cjs").startStudio();
