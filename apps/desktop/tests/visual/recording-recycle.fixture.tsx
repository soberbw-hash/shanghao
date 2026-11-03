import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RecordingRecycleBinButton } from "../../src/renderer/src/components/settings/RecordingRecycleBinButton";
import "../../src/renderer/src/styles/index.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ padding: 40 }}>
      <h1>录音库</h1>
      <RecordingRecycleBinButton
        onRestored={async () => {
          document.body.dataset.restored = "true";
        }}
      />
    </main>
  </StrictMode>,
);
