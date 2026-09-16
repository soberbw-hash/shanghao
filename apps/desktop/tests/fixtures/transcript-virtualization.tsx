import { useState } from "react";
import { createRoot } from "react-dom/client";
import { buildReadableTranscriptParagraphs } from "@private-voice/shared";
import { TranscriptParagraphList } from "../../src/renderer/src/components/settings/TranscriptParagraphList";
import "../../src/renderer/src/styles/parts/130-final-material.css";

const names = new Map([["user", "测试说话人"]]);
const data = buildReadableTranscriptParagraphs(
  Array.from({ length: 2000 }, (_, i) => ({
    id: `segment-${i}`,
    speakerId: "user",
    startMs: i * 10000,
    endMs: i * 10000 + 3000,
    text: "这是一段变高的测试文本。".repeat((i % 6) + 1),
  })),
);
function Fixture() {
  const [count, setCount] = useState(2000);
  const [seek, setSeek] = useState(-1);
  return (
    <>
      <button id="empty" onClick={() => setCount(0)}>
        清空
      </button>
      <button id="small" onClick={() => setCount(2)}>
        两条
      </button>
      <output id="seek">{seek}</output>
      <div id="scroll" style={{ height: 400, width: 500, overflowY: "auto" }}>
        <TranscriptParagraphList
          paragraphs={data.slice(0, count)}
          names={names}
          multipleSpeakers={false}
          onSeek={setSeek}
        />
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
