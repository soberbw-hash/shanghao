import type { ProcessedMicrophoneStream } from "./microphoneProcessor";
import { MicrophoneAcquisitionError } from "./microphoneError";
import { createListenOnlyMicrophone } from "./listenOnlyMicrophone";
import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useAppStore } from "../../store/appStore";

export async function acquireWithListenOnly(
  acquire: () => Promise<MediaStream>,
  own: (processor: ProcessedMicrophoneStream) => void,
): Promise<MediaStream> {
  try {
    return await acquire();
  } catch (error) {
    if (!(error instanceof MicrophoneAcquisitionError)) throw error;
    const processor = await createListenOnlyMicrophone();
    own(processor);
    useAudioStore.getState().setListenOnly(true);
    useRoomStore.getState().setLocalStream(processor.stream);
    useAppStore.getState().pushToast({
      tone: "warning",
      title: "已以静音状态进入",
      description: "麦克风暂时不可用。可以先听和聊天，恢复设备后点击麦克风重试。",
    });
    return processor.stream;
  }
}
