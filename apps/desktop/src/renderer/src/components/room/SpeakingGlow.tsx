export const SpeakingGlow = ({ isSpeaking }: { isSpeaking: boolean }) =>
  isSpeaking ? (
    <div
      className="pointer-events-none absolute inset-0 rounded-[18px] border border-[#8BC4FF]"
      style={{
        boxShadow: "0 0 0 3px rgba(77, 163, 255, 0.12)",
      }}
    />
  ) : null;
