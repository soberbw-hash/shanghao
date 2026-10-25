import { useEffect, useSyncExternalStore } from "react";
import type {
  RemoteControlServiceSnapshot,
  RemoteControlViewerClient,
} from "@private-voice/shared";

const empty = (): RemoteControlServiceSnapshot => ({
  host: { phase: "idle", requests: [] },
  incomingRequests: [],
  remoteShares: {},
  outgoingRequests: {},
  remoteGrants: {},
});
let value = empty();
const listeners = new Set<() => void>();
let users = 0;
let stop: (() => void) | undefined;
let revision = 0;
const update = (next: RemoteControlServiceSnapshot) => {
  revision++;
  value = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useRemoteControlState(
  source?: RemoteControlViewerClient,
): RemoteControlServiceSnapshot {
  useEffect(() => {
    const api = source ?? window.desktopApi?.remoteControl;
    if (!api) return;
    if (users++ === 0) {
      const ownRevision = revision;
      stop = api.onState(update);
      void api
        .get()
        .then((state) => {
          if (users && revision === ownRevision) update(state);
        })
        .catch(() => undefined);
    }
    return () => {
      if (--users === 0) {
        stop?.();
        stop = undefined;
        update(empty());
      }
    };
  }, [source]);
  return useSyncExternalStore(subscribe, () => value);
}
const messages: Record<string, string> = {
  "input-unavailable": "这台电脑暂不支持远程操作。",
  "local-input-unavailable": "本机输入保护尚未就绪。",
  "native-prepare-timeout": "输入保护启动超时，请重试。",
  "request-not-pending": "这次申请已结束，请重新申请。",
  "share-not-requestable": "请分享整个显示器后再申请操作。",
  "transport-unavailable": "当前连接不支持远程操作。",
  "local-denied": "对方拒绝了这次申请。",
  "video-stale": "画面已停止更新，操作已结束。",
};
export const remoteControlMessage = (reason: string) =>
  messages[reason] ?? "暂时无法开始远程操作，请重新申请。";
