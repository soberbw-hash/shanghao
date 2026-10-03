import { useRef, useState } from "react";
import { Image } from "lucide-react";
import { Button } from "../base/Button";
import { shanghaoCore } from "../../core/shanghaoCore";

export const AssetStudioSettingsCard = () => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const run = async (shortcut: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (shortcut) await shanghaoCore.app.createAssetStudioShortcut();
      else await shanghaoCore.app.openAssetStudio();
      setMessage(shortcut ? "桌面入口已创建" : "上号素材已打开");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法打开上号素材");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <article className="about-info-card">
      <span className="about-info-icon about-info-icon--project">
        <Image aria-hidden="true" />
      </span>
      <div className="about-info-copy">
        <h4>上号素材</h4>
        <p>查看图标、房间、天气、角色动作和游戏画面，复制下载并保存审核意见。</p>
      </div>
      <div className="about-card-actions">
        <Button variant="secondary" disabled={busy} onClick={() => void run(false)}>
          打开上号素材
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run(true)}>
          创建桌面入口
        </Button>
      </div>
      <p role="status" style={{ minHeight: "1.5em" }}>
        {message}
      </p>
    </article>
  );
};
