import { EmptyState } from "../base/EmptyState";

export const NoDeviceEmptyState = () => (
  <EmptyState
    title="没有检测到音频设备"
    description="先连接麦克风或扬声器，再到设置里重新检测设备。"
  />
);
