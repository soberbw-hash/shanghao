import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownRight,
  ArrowRight,
  AudioLines,
  Check,
  CircleDot,
  Download,
  Github,
  Headphones,
  Keyboard,
  Laptop,
  Play,
  Radio,
  Sparkles,
} from "lucide-react";
import "./styles.css";
import { downloadUrl, GITHUB_URL, RELEASES_URL, loadRelease } from "./releases";
import type { Release } from "./releases";

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`brand ${compact ? "brand-compact" : ""}`} href="/" aria-label="上号首页">
      <img src="/brand-mark.svg" alt="" />
      <span><strong>上号</strong>{!compact && <small>SHANGHAO</small>}</span>
    </a>
  );
}

function Button({ href, children, variant = "primary", onClick }: { href?: string; children: ReactNode; variant?: "primary" | "quiet" | "dark"; onClick?: () => void }) {
  const className = `button button-${variant}`;
  if (href) return <a className={className} href={href}>{children}</a>;
  return <button className={className} onClick={onClick}>{children}</button>;
}

function BrowserFrame({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`browser-frame ${className}`}>
      <div className="browser-bar"><span /><span /><span /><i>上号</i><b>•••</b></div>
      <img src={src} alt={alt} />
    </div>
  );
}

function ArrowLink({ href = "#features", children }: { href?: string; children: ReactNode }) {
  return <a className="arrow-link" href={href}>{children}<ArrowRight size={16} /></a>;
}

function Hero({ onDownload }: { onDownload: () => void }) {
  return (
    <section className="hero section-shell">
      <div className="hero-copy reveal reveal-1">
        <div className="eyebrow"><span className="eyebrow-dot" />给熟悉的人，留一间小房间</div>
        <h1>上号，然后<br /><em>好好说话。</em></h1>
        <p className="hero-lede">语音、录音、转录，<br className="desktop-break" />都放在一起。</p>
        <div className="hero-actions">
          <Button onClick={onDownload}><Download size={17} />立即下载</Button>
          <Button href={GITHUB_URL} variant="quiet"><Github size={17} />查看 GitHub</Button>
        </div>
        <div className="hero-note"><span>Windows 10 / 11 x64</span><span className="note-divider" /><span>开源 · AGPL-3.0-or-later</span></div>
      </div>
      <div className="hero-visual reveal reveal-2">
        <div className="hero-orbit orbit-one" />
        <div className="hero-orbit orbit-two" />
        <div className="hero-tag tag-room"><Radio size={14} /><span><strong>一号房</strong><small>4 位好友在线</small></span></div>
        <div className="hero-tag tag-local"><CircleDot size={14} /><span><strong>本地优先</strong><small>能留在电脑上的，就留在电脑上</small></span></div>
        <BrowserFrame src="/screens/room.png" alt="上号房间语音界面" />
      </div>
    </section>
  );
}

function TrustStrip() {
  return <div className="trust-strip section-shell"><span>一间房，不需要房主</span><span>最多 5 位固定好友</span><span>录音保存在本机</span><span>服务器只做必要协调</span></div>;
}

function Features() {
  return (
    <section className="features section-shell" id="features">
      <div className="section-intro reveal"><span className="section-index">01 / 03</span><h2>把要用的东西，<br /><em>放在同一间房。</em></h2><p>不需要频道树，也不用反复发会议链接。打开上号，朋友就在这里。</p></div>
      <div className="feature-row feature-room">
        <div className="feature-visual reveal"><BrowserFrame src="/screens/room.png" alt="上号房间界面，展示多人语音与聊天" /></div>
        <div className="feature-copy reveal reveal-1"><div className="feature-number">01 <span>一起上号</span></div><h3>朋友在不在，<br />一眼就知道。</h3><p>一号房和二号房固定存在。角色会走进来、找到工位、坐下；有人说话，房间会给出刚刚好的反馈。</p><ArrowLink>看看房间怎么工作</ArrowLink></div>
      </div>
      <div className="feature-row feature-reverse">
        <div className="feature-copy reveal"><div className="feature-number">02 <span>录下来</span></div><h3>重要的聊天，<br />别让它只停在昨天。</h3><p>录音、标记、播放进度都留在你的电脑。之后再用时间轴和说话人，把一段长录音慢慢看清楚。</p><div className="mini-points"><span><Check size={14} />本地保存</span><span><Check size={14} />AAC / M4A</span><span><Check size={14} />可搜索整理</span></div></div>
        <div className="feature-visual reveal reveal-1"><BrowserFrame src="/screens/recordings.png" alt="上号录音库界面" /></div>
      </div>
      <div className="feature-row feature-ai">
        <div className="feature-visual reveal"><BrowserFrame src="/screens/ai-settings.png" alt="上号本地转录模型管理界面" /></div>
        <div className="feature-copy reveal reveal-1"><div className="feature-number">03 <span>AI 转录</span></div><h3>不是一句“已完成”。<br />而是看得懂的结果。</h3><p>本地 ASR 模型把录音变成有时间轴、有说话人的文字。模型对比也可以慢慢跑，完成一个看一个。</p><ArrowLink>了解本地 AI</ArrowLink></div>
      </div>
    </section>
  );
}

function QuickSoundPreview() {
  const messages = ["上号", "开麦", "等我", "有的兄弟", "好好说话"];
  return <div className="sound-preview">
    <div className="sound-preview-top"><span className="live-dot" />快捷消息 <small>随手点一下，房间里就听见</small><Keyboard size={16} /></div>
    <div className="sound-list">{messages.map((message, index) => <div className={`sound-pill ${index === 1 ? "active" : ""}`} key={message}><span>{index === 1 ? <Play size={12} fill="currentColor" /> : <AudioLines size={14} />}</span>{message}</div>)}</div>
    <div className="shortcut-line"><span><Keyboard size={14} />Ctrl + Alt + 1</span><span>槽位 1</span><b>已就绪</b></div>
  </div>;
}

function LocalSection() {
  const items = [
    { icon: Laptop, title: "本地录音", copy: "录音、标记和播放进度都保存在你的电脑。" },
    { icon: Headphones, title: "实时语音", copy: "朋友之间优先直连，服务器不做中央混音。" },
    { icon: Sparkles, title: "本地 AI", copy: "模型和转录结果留在本机，按需下载和使用。" },
  ];
  return <section className="local-section section-shell" id="about">
    <div className="local-heading reveal"><span className="section-index">02 / 03</span><h2>能在本地完成的，<br /><em>就留在本地。</em></h2><p>服务器存在，但不抢戏。它负责让朋友相遇、让房间保持在那里。</p></div>
    <div className="local-grid">{items.map(({ icon: Icon, title, copy }, index) => <div className="local-item reveal" style={{ "--delay": `${index * 80}ms` } as CSSProperties} key={title}><span className="local-icon"><Icon size={19} /></span><h3>{title}</h3><p>{copy}</p></div>)}</div>
    <div className="local-quote reveal"><span className="quote-mark">“</span><p>它不是一个要你经营的社区。<br /><strong>就是几个人，打开电脑时刚好都在。</strong></p><span className="quote-sign">— ShangHao</span></div>
  </section>;
}

function DownloadSection({ release, loading }: { release: Release | null; loading: boolean }) {
  const windowsAsset = release?.assets.find((asset) => /\.exe$/i.test(asset.name));
  const version = release?.tag_name ?? "最新正式版";
  return <section className="download-section section-shell" id="download">
    <div className="download-card reveal">
      <div className="download-copy"><span className="section-index">03 / 03</span><h2>准备好就<br /><em>上号。</em></h2><p>下载 Windows 版，和熟悉的人进同一间房。</p><div className="download-meta"><span><Check size={14} />Windows 10 / 11 x64</span><span><Check size={14} />当前版本 {version}</span></div><div className="download-actions"><Button href={windowsAsset ? downloadUrl(windowsAsset) : RELEASES_URL}><Download size={17} />{loading ? "读取最新版本…" : "下载 Windows 版"}</Button><Button href={RELEASES_URL} variant="dark">GitHub 备用下载 <ArrowRight size={16} /></Button></div><small className="download-footnote">macOS 版本暂未提供。腾讯云下载与 GitHub 正式安装包一致。</small></div>
      <div className="download-art"><div className="download-orb orb-a" /><div className="download-orb orb-b" /><div className="download-window"><div className="window-top"><span /><span /><span /></div><div className="window-body"><div className="window-avatar"><img src="/avatars/fox.svg" alt="" /></div><div className="window-lines"><i /><i /><i /></div><div className="window-button"><Download size={14} /></div></div></div><div className="download-badge"><Download size={15} /><strong>{release?.tag_name ?? "ShangHao"}</strong><span>Windows x64</span></div></div>
    </div>
  </section>;
}

function Footer() {
  return <footer className="footer section-shell"><Logo compact /><div className="footer-links"><a href="/">首页</a><a href="/download">下载</a><a href={GITHUB_URL}>GitHub <ArrowUpRightIcon /></a></div><span className="copyright">© 2026 ShangHao · AGPL-3.0-or-later</span></footer>;
}

function ArrowUpRightIcon() { return <ArrowDownRight size={13} style={{ transform: "rotate(-135deg)" }} />; }

function DownloadPage({ release, loading, onBack }: { release: Release | null; loading: boolean; onBack: () => void }) {
  const windows = release?.assets.filter((asset) => /\.(exe|msi|zip)$/i.test(asset.name)) ?? [];
  return <main className="download-page section-shell">
    <div className="download-page-head"><button className="back-link" onClick={onBack}><ArrowRight size={16} style={{ transform: "rotate(180deg)" }} />返回首页</button><span className="eyebrow">正式版本 · 腾讯云下载</span></div>
    <div className="download-page-title"><span className="section-index">下载中心</span><h1>下载上号。</h1><p>一个给固定朋友准备的小房间。支持 Windows 10 / 11 x64。</p></div>
    <div className="release-layout">
      <div className="release-main">
        <div className="release-main-top"><div><span className="release-kicker">当前正式版</span><h2>{release?.tag_name ?? (loading ? "读取中…" : "正式版本")}</h2><p>{release ? new Date(release.published_at).toLocaleDateString("zh-CN") : "也可以通过下方 GitHub 入口下载"}</p></div>{windows.length > 0 && <span className="release-status"><span className="live-dot" />可下载</span>}</div>
        <div className="asset-list">{windows.map((asset) => <div key={asset.name}>
          <a className="asset-row" href={downloadUrl(asset)} download={asset.mirror_path ? asset.name : undefined}><span className="asset-icon"><Download size={18} /></span><span className="asset-name"><strong>下载 Windows 安装包</strong><small>{formatBytes(asset.size)} · x64 · {asset.mirror_path ? "腾讯云" : "GitHub"}</small></span><ArrowRight size={17} /></a>
          <a className="arrow-link" href={asset.browser_download_url}><Github size={15} />GitHub 备用下载</a>
          {asset.sha256 && <details className="checksum"><summary>查看文件校验码（SHA-256）</summary><code>{asset.sha256}</code></details>}
        </div>)}{!windows.length && <a className="asset-row" href={RELEASES_URL}><Github size={18} /><span>前往 GitHub 下载最新版</span><ArrowRight size={17} /></a>}</div>
      </div>
      <aside className="release-aside"><div className="aside-label">下载前看一眼</div><ul><li><Check size={15} />主动点击下载，不会自动安装</li><li><Check size={15} />仅提供已发布的正式安装包</li><li><Check size={15} />腾讯云与 GitHub 文件完全一致</li><li><Check size={15} />SmartScreen 提示时请核对来源</li></ul><a href={GITHUB_URL}><Github size={16} />查看项目源码 <ArrowRight size={14} /></a></aside>
    </div>
    <div className="download-page-note"><InfoIcon /><span>目前没有正式 macOS 安装包。网页下载不会更改你电脑上正在运行的版本。</span></div>
  </main>;
}

function InfoIcon() { return <span className="info-icon">i</span>; }
function formatBytes(bytes: number) { if (!bytes) return "大小以 GitHub 页面为准"; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const isDownload = /^\/download\/?$/.test(path);
  useEffect(() => {
    const handlePop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePop);
    const controller = new AbortController();
    loadRelease(controller.signal).then((value) => {
      if (!controller.signal.aborted) { setRelease(value); setLoading(false); }
    });
    return () => { controller.abort(); window.removeEventListener("popstate", handlePop); };
  }, []);
  const navigate = useCallback((target: string) => { window.history.pushState({}, "", target); setPath(target); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const download = useCallback(() => navigate("/download"), [navigate]);
  const page = useMemo(() => isDownload ? <DownloadPage release={release} loading={loading} onBack={() => navigate("/")} /> : <><Hero onDownload={download} /><TrustStrip /><Features /><LocalSection /><section className="quick-section section-shell"><div className="quick-heading reveal"><span className="section-index">小小的细节</span><h2>想说就说，<br /><em>不用找半天。</em></h2><p>快捷消息、音效和音乐，留在房间底部。需要的时候，伸手就能点到。</p></div><QuickSoundPreview /></section><DownloadSection release={release} loading={loading} /></>, [download, isDownload, loading, navigate, release]);
  return <><header className="site-header section-shell"><Logo /><nav><a className={!isDownload ? "active" : ""} href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>首页</a><a className={isDownload ? "active" : ""} href="/download" onClick={(event) => { event.preventDefault(); navigate("/download"); }}>下载</a><a href={GITHUB_URL}>GitHub</a></nav><Button onClick={download}><Download size={15} />立即下载</Button></header>{page}<Footer /></>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
