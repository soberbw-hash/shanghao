import { FolderSearch } from "lucide-react";
import { shanghaoCore } from "../../core/shanghaoCore";
import { useAppStore } from "../../store/appStore";

export const RecordingClipToastActions = ({ filePath }: { filePath: string }) => (
  <span className="block mt-1.5">
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs font-bold"
      onClick={() => {
        void shanghaoCore.recording.showClipInFolder(filePath).catch(() =>
          useAppStore.getState().pushToast({
            tone: "warning",
            title: "找不到片段",
            description: "文件可能已被移动或删除",
          }),
        );
      }}
    >
      <FolderSearch className="size-3.5" />
      在文件夹中显示
    </button>
    <span
      draggable
      className="ml-3 inline-block cursor-grab text-xs"
      title="拖到聊天软件发送"
      onDragStart={(event) => {
        event.preventDefault();
        shanghaoCore.recording.dragClip(filePath);
      }}
    >
      拖出文件
    </span>
  </span>
);
