# 上号官方图标

## 唯一原稿与每版保留

`github-avatar.png` 是用户批准的唯一品牌原稿。只能采用用户提供的文件；禁止重绘、裁切、换色或自行加光。2026-10-01 已从 `C:\Users\sober\Desktop\深色立体耳机应用图标.png` 导入新增勾边和高光的高清版本，实际尺寸 **1254 × 1254**。仓库内 PNG 与用户原文件逐字节相同，SHA-256 为 `17397c7e686279abcea8b8d48d788a02f0a7883f5fe4a69b1405536852de5fa3`。

在仓库根目录运行 `./scripts/generate-brand-assets.ps1 -SourceImage '<用户原始 PNG 路径>'` 完成导入。先验证方形 PNG，随后原样保存到本目录、桌面 build、Renderer、官网；只为 ICO 缩放。所有历史 ICO 文件名和托盘资源同步使用相同图案，避免快捷方式继续引用旧图。

每个安装包包含 `resources/build/icon-master.png` 和 `brand-source.json`：原稿未经重新编码，记录 SHA-256、原始宽高和 ICO 尺寸。Git 中也随每个版本保存原稿。发布时必须先确认本轮原稿已经到位，并核对这些资源，不能把“生成脚本已修改”当成“新图已替换”。

## 尺寸与使用位置

| 位置                                        | 使用方式                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Windows EXE、安装器、桌面、开始菜单、任务栏 | 多尺寸 32-bit ICO：16、20、24、32、40、48、64、128、256 px；由 Windows 根据 DPI 选帧 |
| Windows 托盘                                | 同一 ICO，由系统选合适帧；不使用单色重绘或不同主题的另一套图案                       |
| 软件左上角                                  | 32 CSS px，完整原稿、等比展示                                                        |
| 常规品牌标识                                | 40 CSS px                                                                            |
| 启动画面                                    | 64 CSS px                                                                            |
| 关于上号                                    | 沿用现有布局大小，完整原稿、等比展示                                                 |
| GitHub README                               | 88 CSS px，指向本目录原稿                                                            |
| 官网、网页 favicon                          | 同一原稿，按现有布局等比显示                                                         |

微软列出的常用 Windows 图标尺寸为 16、32、48、256 px，高 DPI 场景还需要中间尺寸。本仓库保留九档；CSS 尺寸是显示尺寸，不要把它当作原文件分辨率。[Microsoft About Icons](https://learn.microsoft.com/en-us/windows/win32/menurc/about-icons)

## 为什么会看到 Electron

开发运行器自身是 `electron.exe`。直接固定这个 EXE，Windows 就会使用 Electron 的名称及内嵌图标；这不等于上号窗口没有设置图标。主窗口必须同时设置 AppUserModelID、图标路径、重新启动名称及完整命令。开发命令必须携带上号项目目录，不能只启动裸 Electron。Electron 要求重新启动名称与命令成对设置。[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window#winsetappdetailsoptions-windows)

正式安装器设置 EXE、桌面和开始菜单图标。已有安装的 EXE 内嵌资源只有在正式重新安装后才会变更；不篡改开发依赖的 Electron 二进制。现有错误固定项需要指向带图标的上号快捷方式，Windows 的旧固定项可能仍需取消固定后重新固定，不能以更换 PNG 冒充这一步已完成。

本机桌面和开始菜单的上号快捷方式已更新图标及 AppUserModelID；确认是本仓库裸运行器的 `Electron.lnk` 已改为启动已安装的上号，并设置同一图标。改动前的快捷方式和外部图标备份在 `%LOCALAPPDATA%\ShangHao-brand-backups\2026-10-01T12-55-22-237Z`。未修改 EXE 内嵌资源、Windows 固定项数据库或真实用户数据。旧固定项名称可能仍缓存为 Electron。

## AI 专用图标

用户另提供的三张蓝色 AI 原图原样保存在 `apps/desktop/src/renderer/src/assets/ai/`：`assistant-entry.png`、`assistant-headset.png` 和 `assistant-answer.png`。2026-10-01 用户明确改为统一采用耳机机器人，并要求去掉方形底板；入口、弹窗标题、等待和答案区均使用独立透明衍生文件 `assistant-headset-cutout.png`，不再切换成气泡或笑脸图。

透明衍生图通过 imagegen 编辑耳机机器人原图，移除蓝色圆角底板及其光晕，保留机器人、耳麦和星光，并清理边缘碎点。原图不覆盖；按钮本身也不叠加色块或阴影，保留键盘焦点边框与点击反馈。AI 图标不替代上号的官方主耳机图标。

采用的透明文件尺寸为 1254 × 1254，SHA-256 为 `b59a97f84714171dc319e8287212bf6beab4df34eae1692a59ba70aef53869f4`。编辑要求：移除整块蓝色圆角底板，仅保留原机器人、耳机、麦克风和星光，透明背景，保持蓝白材质与外形。入口和标题的布局框为 44 px，等待区为 36 px，答案区为 34 px；原图另存，不以抠图文件代替原稿。
