import { useEffect } from "react";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import { desktopApi } from "../utils/desktopApi";

export function usePhoneModeSync(): void {
  useEffect(() => {
    if (!desktopApi.phoneMode) return;
    let verifiedActive = false;
    let eventRevision = 0;
    const apply = (state: { active: boolean; busy?: boolean; error?: string }) => {
      useAudioStore.getState().setPhoneMode(state.active);
      if (state.error)
        useAppStore
          .getState()
          .pushToast({ tone: "warning", title: "系统音频状态未确认", description: state.error });
      if (state.active && !state.busy && !state.error && !verifiedActive) {
        useAppStore.getState().pushToast({
          tone: "success",
          title: "电话模式已开启",
          description: "已确认系统音频设备静音",
        });
      }
      verifiedActive = state.active && !state.busy && !state.error;
    };
    const unsubscribe = desktopApi.phoneMode.onChanged((state) => {
      eventRevision++;
      apply(state);
    });
    void desktopApi.phoneMode
      .get()
      .then((state) => {
        if (eventRevision === 0) apply(state);
      })
      .catch(() => undefined);
    let previous = "";
    const sync = () => {
      const settings = useSettingsStore.getState().settings;
      if (!settings) return;
      const selectedDevices = {
        inputDeviceId: settings.preferredInputDeviceId ?? "",
        outputDeviceId: settings.preferredOutputDeviceId ?? "",
      };
      const key = JSON.stringify(selectedDevices);
      if (key === previous) return;
      previous = key;
      void desktopApi.phoneMode.devices(selectedDevices).catch(() => undefined);
    };
    const settingsOff = useSettingsStore.subscribe(sync),
      audioOff = useAudioStore.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      settingsOff();
      audioOff();
    };
  }, []);
}
