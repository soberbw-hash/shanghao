import { motion } from "framer-motion";

export const SpeakingGlow = ({ isSpeaking }: { isSpeaking: boolean }) =>
  isSpeaking ? (
    <motion.div
      className="absolute inset-0 rounded-[20px] border border-sky-300/40"
      animate={{
        boxShadow: [
          "0 0 0 rgba(139,211,255,0.08)",
          "0 0 32px rgba(139,211,255,0.24)",
          "0 0 0 rgba(139,211,255,0.08)",
        ],
      }}
      transition={{ duration: 1.4, repeat: Infinity }}
    />
  ) : null;
