import { Minus, Square, X } from "lucide-react";

import { IconButton } from "@private-voice/ui";
import { APP_NAME } from "@private-voice/shared";

import { BrandMark } from "../brand/BrandMark";
import { desktopApi } from "../../utils/desktopApi";

export const WindowFrame = () => (
  <div className="window-frame drag-region flex items-center justify-between px-4 py-2.5">
    <div className="window-brand flex items-center gap-3">
      <BrandMark size="sm" />
      <div className="window-brand-copy">
        <div className="window-brand-eyebrow text-[11px] tracking-[0.24em] text-[#98A2B3]">
          SHANGHAO
        </div>
        <div className="window-brand-name text-[15px] font-medium text-[#111827]">{APP_NAME}</div>
      </div>
    </div>
    <div className="window-actions no-drag flex items-center gap-2">
      <IconButton onClick={() => void desktopApi.window.minimize()} aria-label="最小化窗口">
        <Minus className="h-4 w-4" />
      </IconButton>
      <IconButton
        onClick={() => void desktopApi.window.toggleMaximize()}
        aria-label="最大化或还原窗口"
      >
        <Square className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        className="hover:bg-[#FEF2F2] hover:text-[#DC2626]"
        onClick={() => void desktopApi.window.close()}
        aria-label="关闭窗口"
      >
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  </div>
);
