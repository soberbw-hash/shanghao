import { motion } from "framer-motion";

import { Button } from "../base/Button";

const steps = [
  "点“开启房间”，把地址发给朋友。",
  "收到地址后粘贴到首页右侧，点“立即加入”。",
  "底部随时可以静音，按键说话也在同一排。",
];

export const OnboardingModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) =>
  isOpen ? (
    <div className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-[rgba(17,24,39,0.12)] px-6 backdrop-blur-[3px]">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-xl rounded-[24px] border border-[#E7ECF2] bg-white p-6 shadow-[0_24px_48px_rgba(17,24,39,0.12)]"
      >
        <div className="space-y-4">
          <div>
            <div className="text-[22px] font-semibold text-[#111827]">第一次用就看这三步</div>
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
    </div>
  ) : null;
