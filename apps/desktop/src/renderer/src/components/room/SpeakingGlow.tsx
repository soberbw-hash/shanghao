import { motion } from "framer-motion";

export const SpeakingGlow = ({ isSpeaking }: { isSpeaking: boolean }) =>
  isSpeaking ? (
    <motion.div
      className="pointer-events-none absolute inset-0 rounded-[18px] border border-[#8BC4FF]"
      animate={{
        boxShadow: [
          "0 0 0 rgba(77, 163, 255, 0.06)",
          "0 0 0 3px rgba(77, 163, 255, 0.12)",
          "0 0 0 rgba(77, 163, 255, 0.06)",
        ],
      }}
      transition={{ duration: 1.4, repeat: Infinity }}
    />
  ) : null;
