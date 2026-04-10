import { Minus, Square, X } from "lucide-react";

import { IconButton } from "@private-voice/ui";

import { desktopApi } from "../../utils/desktopApi";

export const WindowFrame = () => (
  <div className="drag-region flex items-center justify-between px-5 py-3">
    <div className="text-xs uppercase tracking-[0.24em] text-white/30">Quiet Team</div>
    <div className="no-drag flex items-center gap-2">
      <IconButton onClick={() => void desktopApi.window.minimize()}>
        <Minus className="h-4 w-4" />
      </IconButton>
      <IconButton onClick={() => void desktopApi.window.hide()}>
        <Square className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton className="hover:bg-rose-400/18" onClick={() => void desktopApi.window.close()}>
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  </div>
);
