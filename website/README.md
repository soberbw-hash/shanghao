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
this directory. Deploy the built site with the CloudBase CLI from this folder:

```powershell
npx -p @cloudbase/cli tcb login
npx -p @cloudbase/cli tcb app deploy --framework vite -e shanghao-d3ga95tc8224e727a
```

`tcb login` opens Tencent Cloud authorization in the browser. The CLI keeps
that authorization in local machine configuration; it is not written to this
repository.
