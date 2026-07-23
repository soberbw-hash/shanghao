import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Button } from "../base/Button";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";

const steps = [
  "先设置自己的昵称和角色，好友能一眼认出你。",
  "确认服务器地址后进入固定频道，邀请时会直接复制这个地址。",
  "底部可静音、按键说话、分享屏幕；右侧聊天只在当前频道使用。",
];

export const OnboardingModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="onboarding-modal"
          variants={shouldReduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          className="modal-scrim pointer-events-auto fixed inset-0 flex items-center justify-center px-6"
        >
          <motion.div
            variants={shouldReduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            className="modal-surface w-full max-w-xl rounded-[24px] p-6"
          >
            <div className="space-y-4">
              <div>
                <div id="onboarding-title" className="text-[22px] font-semibold text-[#111827]">
                  第一次进入频道
                </div>
                <p className="mt-1 text-sm text-[#667085]">一分钟就能上手。</p>
              </div>
              <div className="space-y-3">
                {steps.map((step) => (
                  <div
                    key={step}
                    className="rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] px-4 py-3 text-sm text-[#111827]"
                  >
                    {step}
                  </div>
                ))}
              </div>
              <Button className="mt-2" isFullWidth onClick={onClose}>
                知道了
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
