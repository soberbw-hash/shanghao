import { copyFile, mkdir } from "node:fs/promises";

await copyFile("dist/index.html", "dist/404.html");
// Real directory entry: direct /download/ visits don't rely on global Auth-hosting rewrites.
await mkdir("dist/download", { recursive: true });
await copyFile("dist/index.html", "dist/download/index.html");
