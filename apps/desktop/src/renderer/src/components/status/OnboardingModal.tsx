import { motion } from "framer-motion";

import { Button } from "../base/Button";
import { SetupChecklist } from "./SetupChecklist";

export const OnboardingModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) =>
  isOpen ? (
    <div className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/50 px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-xl rounded-[24px] border border-white/8 bg-[#111723] p-6 shadow-panel"
      >
        <div className="space-y-3">
          <div className="text-[24px] font-semibold text-white">Three things to know</div>
          <p className="text-sm leading-6 text-white/55">
            This app stays simple on purpose. Start one room, share one address, mute fast.
          </p>
          <SetupChecklist />
          <Button className="mt-3" isFullWidth onClick={onClose}>
            Continue
          </Button>
        </div>
      </motion.div>
    </div>
  ) : null;
