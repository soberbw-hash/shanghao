import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Headphones } from "lucide-react";
import {
  parsePrivateRoomInvitation,
  privateRoomInvitationDeepLink,
} from "../../packages/shared/src/utils/roomInvite";

export function RoomInvitePage() {
  const [hash, setHash] = useState(window.location.hash);
  const [notice, setNotice] = useState("");
  const attempted = useRef("");
  const invite = useMemo(
    () =>
      hash.length <= 4096
        ? parsePrivateRoomInvitation(new URLSearchParams(hash.slice(1)))
        : undefined,
    [hash],
  );
  const deepLink = invite ? privateRoomInvitationDeepLink(invite) : undefined;
  useEffect(() => {
    const update = () => {
      setHash(window.location.hash);
      setNotice("");
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!deepLink || attempted.current === deepLink) return;
    attempted.current = deepLink;
    // This page is reached by clicking an invitation. Browsers may still require
    // the explicit button below before handing the URL to the installed app.
    window.location.assign(deepLink);
  }, [deepLink]);
  const copyCode = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.channelCode);
      setNotice("频道号已复制");
    } catch {
      setNotice("请选中频道号后复制");
    }
  };
  return (
    <main className="section-shell invite-main">
      <section className="invite-card" aria-labelledby="invite-title">
        <span className="invite-symbol">
          <Headphones size={28} aria-hidden="true" />
        </span>
        <p className="invite-eyebrow">上号 · 房间邀请</p>
        <h1 id="invite-title">{invite ? invite.roomName : "邀请链接不完整"}</h1>
        <p className="invite-lead">
          {invite ? "朋友在房间里等你。" : "请让朋友重新发送邀请链接。"}
        </p>
        {invite && deepLink && (
          <>
            <div className="invite-code">
              <span>频道号</span>
              <code>{invite.channelCode}</code>
              <button type="button" onClick={() => void copyCode()} aria-label="复制频道号">
                <Copy size={16} aria-hidden="true" />
                复制
              </button>
            </div>
            <a
              className="button button-primary invite-open"
              href={deepLink}
              onClick={() => setNotice("正在打开上号，请确认浏览器的打开提示。")}
            >
              打开上号并加入
            </a>
            <p className="invite-help">
              首次使用请先登录，登录后继续加入。也可在上号中输入频道号。
            </p>
          </>
        )}
        <p className="invite-notice" role="status">
          {notice}
        </p>
        <div className="invite-download">
          <span>还没安装上号？</span>
          <a href="/download" target="_blank" rel="noopener noreferrer">
            <Download size={15} aria-hidden="true" />
            下载安装
          </a>
        </div>
        {invite && <p className="invite-help">安装后，返回这里加入房间。</p>}
      </section>
    </main>
  );
}
