import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AudioControlPopover } from "../../src/renderer/src/components/audio/AudioControlPopover";
import { ChatImageLightbox } from "../../src/renderer/src/components/chat/ChatImageLightbox";
import "../../src/renderer/src/styles/index.css";

// Real components, no room, microphone capture, IPC writes or model downloads.
function Fixture() {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<"broken" | "valid">();
  const [volume, setVolume] = useState(1);
  return (
    <main style={{ padding: 24 }}>
      <button id="toggle" onClick={() => setOpen(!open)}>
        菜单开关
      </button>
      <button id="after">菜单之后</button>
      <button id="broken" onClick={() => setImage("broken")}>
        损坏图片
      </button>
      <button id="valid" onClick={() => setImage("valid")}>
        正常图片
      </button>
      <div style={{ position: "relative", marginTop: 550, width: 400 }}>
        <AudioControlPopover
          isOpen={open}
          title="麦克风"
          devices={[]}
          volume={volume}
          min={0.5}
          max={1.5}
          onDeviceChange={() => undefined}
          onVolumePreview={setVolume}
          onVolumeCommit={setVolume}
          onReset={() => setVolume(1)}
          microphoneTest={{
            phase: "ready",
            level: 0,
            isClipping: false,
            onToggle: () => undefined,
            onPlaySystemCapture: () => undefined,
            onPlayProcessed: () => undefined,
          }}
        />
      </div>
      {image ? (
        <ChatImageLightbox
          image={{
            dataUrl:
              image === "broken"
                ? "data:image/png;base64,broken"
                : new URL("../../src/renderer/src/assets/avatars/panda-scene.png", import.meta.url)
                    .href,
            mimeType: "image/png",
            fileName: "隔离测试.png",
            width: 512,
            height: 512,
          }}
          index={0}
          total={2}
          direction={0}
          originElement={null}
          reduceMotion={false}
          onPrevious={() => setImage("broken")}
          onNext={() => setImage("valid")}
          onCopy={() => undefined}
          onClosed={() => setImage(undefined)}
        />
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
