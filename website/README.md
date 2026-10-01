# ShangHao product website

This is a standalone Vite site. It is intentionally outside the desktop
workspace so website work cannot change the Electron client build.

```powershell
corepack pnpm install
corepack pnpm run dev
corepack pnpm run build
```

The site reads the latest public GitHub Release at runtime. No CloudBase
publishable key is needed by this informational site, and no secret belongs in
this directory. The live site uses CloudBase static hosting at the root path.
For a formal release, run these commands from this folder after the GitHub
Release has been published:

```powershell
corepack pnpm release:prepare
npx -p @cloudbase/cli tcb hosting deploy .release-cache/v3.4.0 downloads/v3.4.0 -e shanghao-d3ga95tc8224e727a --verify --safe
corepack pnpm release:activate
corepack pnpm build
npx -p @cloudbase/cli tcb hosting deploy dist / -e shanghao-d3ga95tc8224e727a
```

Replace `v3.4.0` with the release being published. Commit `public/release.json`
after activation. Check the public homepage and `release.json`, HEAD the
versioned installer and its checksum file, and fetch the first bytes of the
installer to confirm downloads work. Keep earlier versioned downloads available
for existing clients; do not use `--prune`.

If GitHub's anonymous API is rate limited, run `release:prepare` with a
temporary `GH_TOKEN` from the existing `gh` login. The script reads it only
from the process environment; never save the token in this repository.

CloudBase CLI 3.8.4's `hosting deploy dist / --verify --safe` failed the root
consistency check during v3.2.0 and its rollback removed live root files.
The site was restored with the root upload command above and checked over HTTPS.
Do not use that root `--safe` combination until its rollback behavior is fixed;
the versioned installer upload with `--verify --safe` succeeded. `tcb login`,
when needed, opens Tencent Cloud authorization in the browser; its credentials
stay in local CLI configuration, not this repository.
