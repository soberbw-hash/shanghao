import { copyFile, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const pages = process.argv.includes("--pages");
const base = pages ? "/shanghao/" : "/";
const repository = "https://github.com/soberbw-hash/shanghao";

// Versioned installers are deployed separately after checksum verification.
// Keep local historical downloads intact without copying them into homepage builds.
for (const entry of await readdir("public", { withFileTypes: true })) {
  if (entry.name === "downloads") continue;
  if (entry.isSymbolicLink()) throw new Error("Public assets cannot be symbolic links.");
  await cp(`public/${entry.name}`, `dist/${entry.name}`, { recursive: true });
}

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

async function readGitHubRelease() {
  const token = process.env.GH_TOKEN;
  const response = await fetch("https://api.github.com/repos/soberbw-hash/shanghao/releases/latest", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`);

  const latest = await response.json();
  if (latest.draft || latest.prerelease || !/^v\d+\.\d+\.\d+$/.test(latest.tag_name)) {
    throw new Error("Expected a stable GitHub release.");
  }
  const name = `ShangHao-${latest.tag_name.slice(1)}-Setup-x64.exe`;
  const installer = latest.assets?.find((item) => item.name === name);
  return {
    tag_name: latest.tag_name,
    published_at: latest.published_at,
    html_url: latest.html_url,
    highlights: (latest.body ?? "")
      .split(/\r?\n/)
      .flatMap((line) => /^- \*\*(.+?)\*\*\s+(.+)$/.exec(line)?.slice(1).join(" ") ?? []),
    assets: [
      {
        name,
        browser_download_url: installer?.browser_download_url,
        size: installer?.size,
        sha256: /^sha256:([a-f0-9]{64})$/.exec(installer?.digest ?? "")?.[1],
      },
    ],
  };
}

const release = pages
  ? await readGitHubRelease()
  : JSON.parse(await readFile("public/release.json", "utf8"));
const asset = release.assets?.[0];
const releasePath = `${repository}/releases`;
if (
  !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
  !/^ShangHao-\d+\.\d+\.\d+-Setup-x64\.exe$/.test(asset?.name ?? "") ||
  asset.name !== `ShangHao-${release.tag_name.slice(1)}-Setup-x64.exe` ||
  asset.browser_download_url !== `${releasePath}/download/${release.tag_name}/${asset.name}` ||
  (!pages && asset.mirror_path !== `/downloads/${release.tag_name}/${asset.name}`) ||
  release.html_url !== `${releasePath}/tag/${release.tag_name}` ||
  !Number.isSafeInteger(asset.size) ||
  asset.size <= 0 ||
  !/^[a-f0-9]{64}$/.test(asset.sha256)
) {
  throw new Error("The download page requires a verified, version-matched release manifest.");
}

const highlights = Array.isArray(release.highlights)
  ? release.highlights.filter((item) => typeof item === "string" && item.trim()).slice(0, 4)
  : [];
const publishedDate = /^\d{4}-\d{2}-\d{2}/.exec(release.published_at)?.[0] ?? "";
const size = (asset.size / 1024 / 1024).toFixed(1);
const download = pages ? asset.browser_download_url : asset.mirror_path;

if (pages) await writeFile("dist/release.json", `${JSON.stringify(release, null, 2)}\n`);
await copyFile("dist/index.html", "dist/404.html");
await mkdir("dist/join", { recursive: true });
await copyFile("dist/join.html", "dist/join/index.html");
await mkdir("dist/download", { recursive: true });
await writeFile(
  "dist/download/index.html",
  `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <link rel="icon" href="${base}brand-mark.png" type="image/png" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#eaf3ff" />
  <meta name="description" content="下载上号 ${escapeHtml(release.tag_name)} Windows 正式版，查看更新亮点与 SHA-256 校验信息。" />
  <title>下载上号 ${escapeHtml(release.tag_name)}｜Windows 正式版</title>
  <style>
    :root{color-scheme:light;font-family:Inter,system-ui,"Microsoft YaHei",sans-serif;color:#152b49;background:#eaf3ff}
    *{box-sizing:border-box}body{min-height:100vh;margin:0;background:radial-gradient(ellipse at 22% 5%,#fff 0,transparent 50%),radial-gradient(ellipse at 85% 85%,#b7d8ff 0,transparent 52%),#eaf3ff}
    a{color:inherit}.shell{max-width:980px;margin:auto;padding:28px 24px 72px}.top{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:68px}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-size:18px;font-weight:800}.brand img{width:36px;height:36px;border-radius:11px}.top>a:last-child{text-decoration:none;color:#476486;font-size:14px}
    .layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(250px,1fr);gap:18px}.card{border:1px solid rgba(255,255,255,.88);border-radius:30px;background:rgba(255,255,255,.64);box-shadow:0 26px 65px rgba(40,78,129,.13),0 3px 14px rgba(40,78,129,.06),inset 0 1px 0 rgba(255,255,255,.94);backdrop-filter:blur(24px)}.main{padding:34px}.side{padding:28px}
    .eyebrow{color:#3974b9;font-size:12px;font-weight:800;letter-spacing:.18em}.version{margin:12px 0 8px;font-size:clamp(37px,6vw,58px);line-height:1.1;letter-spacing:-.04em}.lead{margin:0 0 28px;color:#5b708d;font-size:15px;line-height:1.7}.download{display:flex;align-items:center;justify-content:center;gap:10px;min-height:56px;padding:12px 18px;border-radius:17px;background:#1677e9;color:white;text-align:center;text-decoration:none;font-size:17px;font-weight:800;box-shadow:0 12px 25px rgba(22,119,233,.25),inset 0 1px 0 rgba(255,255,255,.3)}.download:hover{background:#0969d5}.meta{display:flex;gap:15px;flex-wrap:wrap;margin-top:16px;color:#677d9a;font-size:13px}.meta span{white-space:nowrap}
    .side h2{margin:0 0 18px;font-size:18px}.side ul{margin:0;padding-left:19px;color:#405a79;line-height:1.7;font-size:14px}.side li+li{margin-top:10px}.side>a{display:inline-block;margin-top:22px;font-size:14px;color:#196dc5;text-decoration:none;font-weight:700}.checksum{margin-top:18px;padding:20px 24px}.checksum summary{cursor:pointer;font-size:14px;font-weight:700}.checksum code{display:block;margin-top:13px;overflow-wrap:anywhere;color:#536a87;font-size:12px;line-height:1.6}.foot{margin-top:30px;color:#6d819b;font-size:13px;line-height:1.8}.foot a{color:#346dab;text-decoration:none}
    @media(max-width:700px){.top{margin-bottom:38px}.layout{grid-template-columns:1fr}.main,.side{padding:25px}.shell{padding:22px 16px 52px}}
  </style>
</head>
<body>
  <div class="shell">
    <header class="top"><a class="brand" href="${base}"><img src="${base}brand-mark.png" alt="" />上号</a><a href="${base}">返回首页</a></header>
    <main>
      <div class="layout">
        <section class="card main" aria-labelledby="version"><div class="eyebrow">WINDOWS 10 / 11 · X64</div><h1 class="version" id="version">上号 ${escapeHtml(release.tag_name)}</h1><p class="lead">下载后打开安装包，按提示安装或更新。</p><a class="download" href="${escapeHtml(download)}"${pages ? "" : ` download="${escapeHtml(asset.name)}"`}>下载 Windows 安装包 ↓</a><div class="meta"><span>${escapeHtml(size)} MB</span>${publishedDate ? `<span>发布于 ${escapeHtml(publishedDate)}</span>` : ""}</div></section>
        ${highlights.length ? `<aside class="card side"><h2>这一版的更新</h2><ul>${highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></aside>` : ""}
      </div>
      <details class="card checksum"><summary>核对安装包 SHA-256</summary><code>${escapeHtml(asset.sha256)}</code></details>
    </main>
  </div>
</body>
</html>\n`,
);
