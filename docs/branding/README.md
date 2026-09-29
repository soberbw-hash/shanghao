# 上号图标原稿

`github-avatar.png` 是产品图标的唯一原稿。2026-09-27 用户再次提供的 512 × 512 PNG 与此文件逐像素一致；耳机、立体高光、背景和阴影都保持原样。

在仓库根目录运行 `./scripts/generate-brand-assets.ps1`，会把原稿字节原样复制给桌面窗口、启动画面、设置页、托盘和官网使用的 PNG，并生成 Windows EXE、安装器与快捷方式需要的多尺寸 ICO。ICO 只按 Windows 格式要求缩放，不重绘或裁切。`apps/desktop/tests/assets.test.ts` 校验 PNG 字节一致及 ICO 配置。

当前安装的软件 EXE 与桌面快捷方式需要在下一次正式安装后才会更新图标；本次没有打包或覆盖已安装程序。
