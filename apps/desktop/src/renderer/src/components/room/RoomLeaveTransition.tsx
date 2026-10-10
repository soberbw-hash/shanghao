import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { OperationFeedbackIcon } from "../base/OperationFeedbackIcon";
import { motionTransition } from "../../features/motion/motionSystem";

/** Keep recording ownership mounted until the real finalizer completes. */
export const RoomLeaveTransition = ({ recording }: { recording: boolean }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const wasRecording = useRef(recording);
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="room-leave-title"
      aria-busy="true"
      onCancel={(event) => event.preventDefault()}
      className="island-panel m-auto w-full max-w-xs rounded-3xl p-7 text-center text-[#263b56] backdrop:bg-slate-900/20"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? motionTransition.reduced : motionTransition.overlay}
        className="flex flex-col items-center gap-3"
      >
        <OperationFeedbackIcon state="pending" />
        <h2 id="room-leave-title" className="text-balance text-lg font-semibold">
          正在退出房间
        </h2>
        <p role="status" className="text-pretty text-sm text-slate-500">
          {wasRecording.current ? "正在保存录音…" : "正在结束连接…"}
        </p>
      </motion.div>
    </dialog>
  );
};
