import { EmptyState } from "../base/EmptyState";

export const NoDeviceEmptyState = () => (
  <EmptyState
    title="没有检测到音频设备"
    description="先接好麦克风或扬声器，再回来开黑。"
  />
);
