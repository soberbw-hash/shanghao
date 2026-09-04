import { copyFile, mkdir, writeFile } from "node:fs/promises";

await copyFile("dist/index.html", "dist/404.html");
// Real directory entry: direct /download/ visits don't rely on global Auth-hosting rewrites.
await mkdir("dist/download", { recursive: true });
await writeFile(
  "dist/download/index.html",
  `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#edf6ff" />
    <title>正在准备上号安装包</title>
    <style>
      html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#edf6ff;color:#1e3555;font:600 16px/1.6 system-ui,"Microsoft YaHei",sans-serif}.card{padding:24px 30px;border:1px solid #c9def4;border-radius:20px;background:rgba(255,255,255,.86);box-shadow:0 20px 60px rgba(52,91,136,.14)}
    </style>
  </head>
  <body>
    <div class="card" id="status">正在获取最新版本并开始下载…</div>
    <script>
      fetch('/release.json', { cache: 'no-store' })
        .then((response) => { if (!response.ok) throw new Error('manifest'); return response.json(); })
        .then((release) => {
          const asset = Array.isArray(release.assets) ? release.assets[0] : null;
          const target = asset && (asset.mirror_path || asset.browser_download_url);
          if (!target) throw new Error('asset');
          location.replace(target);
        })
        .catch(() => {
          document.getElementById('status').textContent = '暂时无法读取下载地址，正在转到 GitHub Release…';
          setTimeout(() => location.replace('https://github.com/soberbw-hash/shanghao/releases/latest'), 800);
        });
    </script>
  </body>
</html>\n`,
);
