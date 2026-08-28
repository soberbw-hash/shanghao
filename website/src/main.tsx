import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  Download,
  Github,
  Headphones,
  Keyboard,
  Laptop,
  MessageCircle,
  Mic2,
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
      <span>
        <strong>上号</strong>
        {!compact && <small>SHANGHAO</small>}
      </span>
    </a>
  );
}

function Button({
  href,
  children,
  variant = "primary",
  onClick,
}: {
  href?: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "plain";
  onClick?: () => void;
}) {
  const className = `button button-${variant}`;
  if (href)
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  return (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  );
}

function ProductShot({
  src,
  alt,
  caption,
  className = "",
}: {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={`product-shot ${className}`}>
      <div className="product-shot-image">
        <img src={src} alt={alt} />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function SectionHeading({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function Hero({ onDownload }: { onDownload: () => void }) {
  return (
    <section className="hero section-shell">
      <div className="hero-copy entrance">
        <span className="kicker">
          <Radio size={15} />
          给固定朋友的桌面语音房
        </span>
        <h1>
          和熟悉的人，
          <br />
          待在同一间房。
        </h1>
        <p className="hero-lede">语音、录音和转录，都放在一起。</p>
        <div className="hero-actions">
          <Button onClick={onDownload}>
            <Download size={18} />
            下载 Windows 版
          </Button>
          <Button href={GITHUB_URL} variant="secondary">
            <Github size={18} />
            查看源码
          </Button>
        </div>
        <p className="hero-note">支持 Windows 10 / 11 x64，开源且免费。</p>
      </div>
      <ProductShot
        className="hero-shot entrance entrance-late"
        src="/screens/room.png"
        alt="上号桌面端的一号房界面"
        caption="一号房正在使用中"
      />
    </section>
  );
}

function Facts() {
  const facts = [
    ["固定房间", "打开就能回来"],
    ["最多 5 人", "留给真正熟悉的人"],
    ["录音在本机", "文件由自己保管"],
    ["需要时再转录", "不打扰正在聊天"],
  ];
  return (
    <div className="facts section-shell">
      {facts.map(([title, copy]) => (
        <div key={title}>
          <strong>{title}</strong>
          <span>{copy}</span>
        </div>
      ))}
    </div>
  );
}

function RoomSection() {
  const notes = [
    [Radio, "房间一直都在", "不用建群，也不用每次重开会议。"],
    [MessageCircle, "状态说人话", "谁在线、谁正在说话，一眼就知道。"],
    [Mic2, "设备随时可调", "麦克风和扬声器就在房间底部。"],
  ] as const;
  return (
    <section className="room-section section-shell" id="features">
      <SectionHeading
        title="进房间，就能直接说话。"
        copy="朋友在不在、谁正在说话、谁在放音乐，房间里都看得清楚。"
      />
      <ProductShot src="/screens/room.png" alt="上号语音房间、角色座位和聊天区域" />
      <div className="room-notes">
        {notes.map(([Icon, title, copy]) => (
          <div className="room-note" key={title}>
            <Icon size={20} />
            <div>
              <strong>{title}</strong>
              <span>{copy}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecordSection() {
  return (
    <section className="record-section section-shell" id="about">
      <div className="record-copy">
        <SectionHeading
          title="聊过的内容，之后还能找回来。"
          copy="录音、标记和播放进度保存在本机。需要整理时，再选择合适的模型慢慢处理。"
        />
        <ul className="check-list">
          <li>
            <Check size={17} />
            长录音完整保存，不替你随意裁切
          </li>
          <li>
            <Check size={17} />
            时间轴、说话人和文本放在一起
          </li>
          <li>
            <Check size={17} />
            多个转录模型可以直接比较
          </li>
        </ul>
      </div>
      <ProductShot src="/screens/recordings.png" alt="上号录音库和多模型转录界面" />
      <ProductShot
        className="comparison-shot"
        src="/screens/comparison.png"
        alt="上号转录模型对比和房间界面"
        caption="同一段录音，可以按自己的方式整理"
      />
    </section>
  );
}

function QuickSoundPreview() {
  return (
    <div className="quick-preview" aria-label="快捷消息示意">
      <div className="quick-preview-head">
        <div>
          <MessageCircle size={18} />
          <strong>快捷消息</strong>
        </div>
        <span>房间内可用</span>
      </div>
      <div className="quick-buttons">
        {["吼大声", "要笑", "捞", "回手掏", "上号"].map((message) => (
          <button key={message}>{message}</button>
        ))}
      </div>
      <div className="music-buttons">
        {["出泪小曲", "出心小曲", "得吃小曲"].map((music) => (
          <button key={music}>
            <AudioLines size={14} />
            {music}
          </button>
        ))}
      </div>
      <div className="shortcut">
        <Keyboard size={16} />
        <span>Ctrl + Alt + 1</span>
        <b>快捷键已就绪</b>
      </div>
    </div>
  );
}

function QuickSection() {
  return (
    <section className="quick-section section-shell">
      <div>
        <SectionHeading
          title="常说的话，点一下就发出去。"
          copy="快捷消息、音效和音乐都放在房间里。鼠标点一下，或者直接按快捷键。"
        />
        <p className="quick-detail">最多放三首常用音乐，够用，也不会把界面挤满。</p>
      </div>
      <QuickSoundPreview />
    </section>
  );
}

function LocalSection() {
  const items = [
    [Laptop, "录音", "文件保存在电脑里。"],
    [Headphones, "语音", "朋友之间优先直连。"],
    [Sparkles, "转录", "模型按需下载使用。"],
  ] as const;
  return (
    <section className="local-section section-shell">
      <div className="local-statement">
        <h2>
          能留在电脑里的，
          <br />
          就不多绕一圈。
        </h2>
        <p>服务器负责让朋友相遇，个人录音和本地模型仍由你自己保管。</p>
      </div>
      <div className="local-list">
        {items.map(([Icon, title, copy]) => (
          <div key={title}>
            <Icon size={20} />
            <strong>{title}</strong>
            <span>{copy}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DownloadSection({ release, loading }: { release: Release | null; loading: boolean }) {
  const version = release?.tag_name ?? "最新正式版";
  return (
    <section className="download-section section-shell" id="download">
      <div className="download-card">
        <img src="/brand-mark.svg" alt="" />
        <div>
          <h2>准备好了，就上号。</h2>
          <p>下载 Windows 版，和熟悉的人进同一间房。</p>
        </div>
        <div className="download-card-action">
          <Button href="/download">
            <Download size={18} />
            {loading ? "读取版本中" : `下载 ${version}`}
          </Button>
          <span>Windows 10 / 11 x64</span>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer section-shell">
      <Logo compact />
      <div className="footer-links">
        <a href="/">首页</a>
        <a href="/download">下载</a>
        <a href={GITHUB_URL}>GitHub</a>
      </div>
      <span>© 2026 ShangHao · AGPL-3.0-or-later</span>
    </footer>
  );
}

function DownloadPage({
  release,
  loading,
  onBack,
}: {
  release: Release | null;
  loading: boolean;
  onBack: () => void;
}) {
  const windows = release?.assets.filter((asset) => /\.(exe|msi|zip)$/i.test(asset.name)) ?? [];
  return (
    <main className="download-page section-shell">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={17} />
        返回首页
      </button>
      <div className="download-page-heading">
        <span>WINDOWS</span>
        <h1>下载上号</h1>
        <p>正式安装包。支持 Windows 10 / 11 x64。</p>
      </div>
      <div className="release-layout">
        <section className="release-panel">
          <div className="release-head">
            <div>
              <span>当前正式版</span>
              <h2>{release?.tag_name ?? (loading ? "正在读取" : "最新版本")}</h2>
            </div>
            {release && <time>{new Date(release.published_at).toLocaleDateString("zh-CN")}</time>}
          </div>
          {loading && (
            <div className="release-loading">
              <i />
              <i />
              <i />
            </div>
          )}
          {!loading && windows.length > 0 && (
            <div className="asset-list">
              {windows.map((asset) => (
                <div className="asset" key={asset.name}>
                  <a
                    className="asset-download"
                    href={downloadUrl(asset)}
                    download={asset.mirror_path ? asset.name : undefined}
                  >
                    <span className="asset-icon">
                      <Download size={20} />
                    </span>
                    <span>
                      <strong>{asset.name}</strong>
                      <small>
                        {formatBytes(asset.size)} · {asset.mirror_path ? "腾讯云" : "GitHub"}
                      </small>
                    </span>
                    <ArrowRight size={18} />
                  </a>
                  <div className="asset-links">
                    <a href={asset.browser_download_url}>
                      <Github size={15} />
                      GitHub 备用下载
                    </a>
                    {asset.sha256 && (
                      <details>
                        <summary>查看 SHA-256</summary>
                        <code>{asset.sha256}</code>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && windows.length === 0 && (
            <div className="release-empty">
              <p>暂时没有读取到安装包。</p>
              <Button href={RELEASES_URL} variant="secondary">
                <Github size={17} />
                前往 GitHub 下载
              </Button>
            </div>
          )}
        </section>
        <aside className="download-aside">
          <h2>下载前看一眼</h2>
          <ul>
            <li>
              <Check size={16} />
              只提供已经发布的正式安装包
            </li>
            <li>
              <Check size={16} />
              腾讯云与 GitHub 文件一致
            </li>
            <li>
              <Check size={16} />
              网页不会自动安装或覆盖旧版本
            </li>
            <li>
              <Check size={16} />
              SmartScreen 提示时请核对来源
            </li>
          </ul>
          <a href={GITHUB_URL}>
            <Github size={16} />
            查看项目源码
            <ArrowRight size={15} />
          </a>
        </aside>
      </div>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "大小以下载页面为准";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
      if (!controller.signal.aborted) {
        setRelease(value);
        setLoading(false);
      }
    });
    return () => {
      controller.abort();
      window.removeEventListener("popstate", handlePop);
    };
  }, []);

  const navigate = useCallback((target: string) => {
    window.history.pushState({}, "", target);
    setPath(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const download = useCallback(() => navigate("/download"), [navigate]);
  const page = useMemo(
    () =>
      isDownload ? (
        <DownloadPage release={release} loading={loading} onBack={() => navigate("/")} />
      ) : (
        <>
          <Hero onDownload={download} />
          <Facts />
          <RoomSection />
          <RecordSection />
          <QuickSection />
          <LocalSection />
          <DownloadSection release={release} loading={loading} />
        </>
      ),
    [download, isDownload, loading, navigate, release],
  );

  return (
    <>
      <header className="site-header">
        <div className="section-shell header-inner">
          <Logo />
          <nav>
            <a
              className={!isDownload ? "active" : ""}
              href="/"
              onClick={(event) => {
                event.preventDefault();
                navigate("/");
              }}
            >
              首页
            </a>
            <a
              className={isDownload ? "active" : ""}
              href="/download"
              onClick={(event) => {
                event.preventDefault();
                navigate("/download");
              }}
            >
              下载
            </a>
            <a href={GITHUB_URL}>GitHub</a>
          </nav>
          <Button onClick={download}>
            <Download size={16} />
            立即下载
          </Button>
        </div>
      </header>
      {page}
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
