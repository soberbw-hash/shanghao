# Windows 包体积审计（2026-09-27）

## 测量口径

- 基线：本机现存的正式 v3.2.2 `release/win-unpacked` 与安装包；没有重建或覆盖。
- 候选：相同版本、当前工作区代码构建到独立验证目录的 NSIS 安装包与 `win-unpacked`。它仅用于本地验证，没有发布。
- 数值是磁盘文件大小，MiB = 1,048,576 字节。`app.asar` 内的分类是归档中的逻辑大小，不应与 `app.asar.unpacked` 再相加。
- `scripts/report-package-size.mjs` 生成逐项 JSON，列出最大的 20 个物理文件和归档文件；正式构建将附带 `package-size.json` 与对应校验和。

| 项目                                    |   正式基线 |   独立候选 |        变化 |
| --------------------------------------- | ---------: | ---------: | ----------: |
| NSIS 安装包                             | 199.58 MiB | 164.01 MiB |  −35.56 MiB |
| 安装后文件总量                          | 582.28 MiB | 467.16 MiB | −115.12 MiB |
| Electron 运行时（不含 resources）       | 310.68 MiB | 310.68 MiB |           0 |
| app.asar                                |  87.60 MiB |  51.44 MiB |  −36.16 MiB |
| app.asar.unpacked                       |  79.70 MiB |   0.74 MiB |  −78.96 MiB |
| asar 内 production node_modules（逻辑） | 137.49 MiB |  23.97 MiB | −113.52 MiB |
| asar 内 Renderer dist（逻辑）           |  26.10 MiB |  26.10 MiB |           0 |
| 独立 FFmpeg 资源                        |  78.96 MiB |  78.96 MiB |           0 |
| DeepFilterNet 资源                      |  16.79 MiB |  16.79 MiB |           0 |
| 快捷消息 AAC                            |   7.88 MiB |   7.88 MiB |           0 |
| 原生辅助程序                            |   0.45 MiB |   0.45 MiB |           0 |

候选包中 `resources` 合计约 156.48 MiB；Electron 运行时约 310.68 MiB。余下重量的主要原因是 Electron 本体、单份 FFmpeg、真实的 Renderer 资源、账号 SDK 和音频处理资源。安装包压缩率与安装后磁盘占用不同，因此两个数字都保留在报告中。

## 已确认并处理的重复项

1. **FFmpeg：**原包同时存在 `resources/ffmpeg/ffmpeg.exe` 和 `ffmpeg-static` 内的同一 78.96 MiB 文件，SHA-256 相同。候选包只保留前者，`ffmpeg-static` 的 JS 解析入口仍在。主进程录音、响度分析和 ASR 解码仍依赖 FFmpeg，因此没有移除该能力或缩减编解码器。
2. **Renderer 库：**React、React DOM、Framer Motion、GSAP、Lucide、Zustand、字体包等均已进入 Vite 的 Renderer `dist`。检查 Main/Preload 的源码引用和编译后 Main 的外部 `require` 后，排除了它们在 production `node_modules` 中的原始副本；候选包中这组重复项为 0 MiB。
3. **调试与平台文件：**候选 `app.asar` 中没有 source map；Electron locales 只有 `zh-CN` 和 `en-US`；`dist-electron/tests` 继续由打包规则排除。原生程序、许可文本和更新资源仍由包内校验检查。

## 需要继续保留的重量

- **CloudBase 与 Supabase：**主进程 `AccountService` 仍按账号提供者走两套有效路径，包含旧会话恢复；当前不能把 Supabase 视为无用 SDK。包内约有 7.80 MiB CloudBase 与 4.34 MiB Supabase 归档内容。后续若移除旧提供者，须先有账号迁移与回退验收。
- **DeepFilterNet：**17 MB 左右的 WASM/ONNX 资源属于当前实时语音降噪路径。按需下载可能减小初装包，但会把首次使用音频质量交给网络状态；本轮保留。
- **字体与视觉资源：**Renderer 的 Noto Sans SC WOFF2 子集约 4.30 MiB，包内资源校验发现 98 个有效字体文件；天气、角色与场景图片是当前界面直接引用的资源。没有为了小幅降重删字体或改动视觉质量。
- **快捷消息：**47 个 AAC 文件约 7.88 MiB，包内逐个检查了 AAC 头和数量。没有重压缩导致音质下降。
- **原生模块和系统组件：**`uiohook-napi`、Electron 更新器、Rust/手机麦克风辅助程序仍有运行职责。不会为压缩体积迁移 Electron 或替换已验证的媒体路径。

## 长期约束与尚待核查

- `docs/package-size-budget.json` 设定安装包 185 MiB、安装后 520 MiB、`app.asar` 80 MiB，并要求恰好一份 FFmpeg、Renderer 原始副本低于 1 MiB。发布工作流在打包后写出报告、与 v3.2.2 正式基线比较并执行预算检查；未来每个 Release 可从随附 JSON 追踪体积。
- 诊断日志已有单文件 10 MiB、每类最多 5 份的轮转。AI 安装使用无 pip 下载缓存。天气缓存有有效期；其他可下载模型和用户录音不是可随意清理的缓存，不能自动删除。
- 仍需逐项审查大型 SDK 的内部子模块、未来新增的静态素材和长时间运行时缓存增长。`qrcode` 等小型 Renderer 依赖在候选归档中仍约 0.11 MiB，当前收益不足以承担额外打包行为变化。
- 通过了候选包的 AI 脚本哈希、CloudBase 配置、原生程序、DeepFilter、字体、快捷消息、许可文本与 Windows 执行级别检查。尚未通过安装候选包进行真实设备的五人通话、录音和旧客户端更新验收；这些验证不能由静态包检查代替。

## 后续补充：转录临时文件

ASR 在系统临时目录的 `shanghao-voice-memory` 子目录生成 16 kHz 单声道 WAV，正常完成或报错后会在 `finally` 中删除。此前文件名只包含录音哈希、片段偏移和进程 ID；同一进程并行处理同一片段时可能共用路径。现已增加随机 UUID，避免覆盖。启动时异步清理 7 天以上、严格匹配本程序新旧命名格式的普通 WAV，单次最多 100 个；不递归、不跟随符号链接，也不碰用户录音目录、模型、转录结果或其他临时文件。日志只记录数量和字节数，不记录录音名称。

该治理主要限制崩溃遗留文件导致的长期磁盘增长，对安装包大小没有影响。本轮只在测试专用临时目录验证了清理规则，没有把用户真实数据目录当作测试夹具。

明确删除一条语音记忆时，存储层会同时删除该录音专属的转录事件 NDJSON。清空转录结果现会在同一存储队列中保存空结果并清除该录音的事件日志；同一录音的任务启动、清空和删除按序执行，删除能阻止进行中的清空重新写回记录。其他录音、Marker 和原始录音保留。已在独立临时目录验证，未对真实用户目录做清理。

## 后续补充：图标一致性

桌面 UI、官网与 Windows 资源现统一使用 `docs/branding/github-avatar.png` 的原始像素。正式包只需 `icon.png` 和两份从原稿生成的多尺寸 ICO；旧的扁平图标、深浅托盘变体已从打包清单移除。旧候选包的 MiB 数值是历史对照；包含当前图标的实测见文末新候选报告。

重编码前的普通构建中，Renderer `dist/assets` 共 192 个文件、26.33 MiB：PNG 19.37 MiB、WOFF2 4.30 MiB、JS 1.37 MiB、CSS 0.43 MiB，其余格式合计约 0.93 MiB。对全部 192 个文件按 SHA-256 分组，未发现字节完全相同的重复资源。重编码后再次普通构建，PNG 降至 18.26 MiB；没有打包 EXE，因此暂不换算 NSIS 压缩收益。

## 后续补充：更新缓存的实际占用

本机只读检查发现 `%LOCALAPPDATA%/shanghao-updater` 当前约 399.55 MiB：根目录 `installer.exe` 约 199.57 MiB，`pending` 内的 v3.2.2 安装包约 199.57 MiB，另有两份约 0.21 MiB 的 blockmap 与少量元数据。这说明更新缓存可能同时占用一份旧安装器和一份待用户确认的新安装器；不能把安装包体积等同于长期磁盘占用。

当前使用的 `electron-updater` 6.8.9 在下一次下载时按版本哈希检查 `pending/update-info.json`，不匹配时清空待下载目录；增量下载会读取根目录 `installer.exe` 作为旧包。已下载的新包仍需由用户点击“安装并重启”，所以本轮没有清理真实缓存，也没有增加启动时自动删除规则。后续应在真实旧版升级验收后观察安装完成与再次更新时这两份文件的生命周期，再决定是否需要仅针对已过期安装器的有界回收。

## 后续补充：Renderer 模块画像

`corepack pnpm --dir apps/desktop report:renderer` 默认生成可覆盖的 `docs/renderer-bundle-audit-latest.json`；指定输出路径可留存某次快照，例如 `corepack pnpm --dir apps/desktop report:renderer docs/renderer-bundle-audit-2026-09-27.json`。本轮[逐 chunk 快照](renderer-bundle-audit-2026-09-27.json)记录各 JS chunk 的实际文件大小、静态和动态依赖、模块来源及重复情况。当前 JS 总计约 1.37 MiB，其中入口静态依赖约 0.86 MiB、按需加载约 0.52 MiB；没有同一个模块出现在多个 JS chunk。模块来源的 `renderedLength` 是最终压缩前的估算，不应与 chunk 文件字节数相加。

主要 chunk 是应用共享代码约 332 KiB、设置页约 252 KiB、房间页约 241 KiB、Motion 约 186 KiB、React 约 178 KiB。`DialogCloseButton` 这个共享 chunk 名称来自 Rollup 命名，内容还包括应用公共逻辑，不能按名称误判为一个关闭按钮占了 332 KiB。二维码库只在手机配对链接出现时才加载：房间页由约 264 KiB 降至约 241 KiB，新增约 23 KiB 的按需 chunk；整体 JS 大小基本不变。这降低了普通进房路径的解析量，扫码界面仍待真实设备核对。

源码里有未被引用的旧版 HarmonyOS 字体和场景原稿，但当前 Renderer 构建没有把它们带入 `dist`，因此删除源码文件不会缩小安装包。CloudBase、Supabase、Framer Motion、GSAP、Lucide 数据和组件包都查到实际引用；本轮没有为了依赖数量好看而删除它们。

## 后续补充：FFmpeg、内置音频和场景 PNG

正式 v3.2.2 包中的 FFmpeg 为 6.1.1 essentials build，二进制 82,797,568 字节。源码中的生产调用覆盖三类：录音转为 48 kHz AAC/M4A（含 faststart）、录音完整性/静音检测（`volumedetect` 与 null 输出）、ASR 输入转为 16 kHz 单声道 PCM16 WAV；另有读取录音时长和音频格式的探测调用。输入端必须兼容用户已有录音，不能仅凭当前输出格式裁掉其他解码器。此构建还带有大量视频和网络能力，但本轮没有经兼容性验证的更小 Windows FFmpeg 替代品，因此保留唯一的一份完整二进制。

逐个用正式包的 FFmpeg 只读探测了 47 个内置 AAC：34 个语音共 0.98 MiB，均为 44.1 kHz 单声道，时长 0.5–5.3 秒；13 个音乐共 6.90 MiB，均为 44.1 kHz 立体声，时长 13.5–46 秒。未发现解析失败。音乐占主要体积，现有声道分配合理；未经听感比较不做再次有损压缩。

对 14 张当前使用的房间场景 PNG 做了无损重编码，逐张确认尺寸、色彩模式及像素完全一致，文件总量从 13,913,704 字节降至 12,752,060 字节，减少 1,161,644 字节（约 1.11 MiB）。三张未进入当前 Renderer 构建的旧场景原稿未改动。此处节省的是未压缩资源大小，不能直接等同于 NSIS 安装包减少量；安装包仍需未来正式打包后测量。

隔离规模实验补充：1200 条小型录音的目录读取连续执行 22 次，首次约 76 毫秒、再次约 61 毫秒；在后续 20 次读取后，元数据文件的字节数和修改时间保持不变，目录无 `.tmp` 残留。该夹具只检验大量条目和重复读，不代表几周运行中的日志、更新器或真实模型下载增长；旧版客户端升级后的缓存生命周期仍需随实机更新验收观察。

## 后续补充：目标平台原生插件与工作区源码

对本机现存的正式 v3.2.2 包再次只读检查：`app.asar` 中有 7 份 `uiohook-napi` 原生插件，只有 `win32-x64` 供当前 Windows x64 客户端使用，其余 6 份合计 525,240 字节（约 0.50 MiB）。五个 `@private-voice` 工作区包的入口均指向 `dist/index.js`；包内额外包含 84 个 `src` 文件，合计 437,746 字节（约 0.42 MiB）。未发现主进程、预加载或包入口对这些 `src` 路径的运行时引用。

CloudBase SDK 的主进程 `require('@cloudbase/js-sdk')` 在当前依赖版本解析到 `dist/index.node.cjs.js`；正式包还带有供小程序平台使用的 `miniprogram_dist`，14 个文件合计 2,297,675 字节（约 2.19 MiB）。打包配置只排除这个独立平台目录，保留 Node 与 Web 的其他 SDK 入口及许可文件。

打包配置现仅排除上述 6 个已确认的非目标插件目录、工作区 `src` 和 CloudBase 小程序目录，保留 `win32-x64` 插件与所有工作区 `dist` 入口；发布包校验要求目标插件存在，且这些冗余内容为零。体积报告与预算检查也分别统计残留。2026-09-28 的新候选包已验证这些排除规则；约 3.11 MiB 是旧包中对应文件的逻辑大小，不能单独当成 NSIS 压缩收益。登录与快捷键仍需对候选程序做真实交互检查。

体积报告现进一步按 Electron 运行时、`app.asar.unpacked`、FFmpeg、DeepFilter、快捷消息、原生辅助程序、其他资源、原生插件、Renderer JS/CSS/字体/图片和 production `node_modules` 输出当前值与基线差额。旧正式包的这些分类已记录到 `docs/package-size-baseline-v3.2.2.json`；用现存正式包只读生成报告后，所有分类差额均为 0。物理分类加总恰好为旧包安装后文件总量 610,561,169 字节。Renderer、插件与 `node_modules` 分类是 `app.asar` 内逻辑大小，可能和物理资源行重叠，不能再加入总量；安装包另有压缩。新候选的实际差额见下节。

## 2026-09-28 独立候选包实测

将当前本地代码打包到系统临时目录下的独立审计路径，没有覆盖仓库内的正式 `release`，也没有发布或安装。仓库目录下两次尝试均在 Electron 展开 `default_app.asar` 时遇到 Windows `EPERM`/`EBUSY`；改用系统临时目录后完成 NSIS 构建。[候选包完整报告](package-size-candidate-2026-09-28.json)保留安装包、安装后文件、`app.asar` 分类和最大的 20 个物理及归档文件。

| 项目                                      | 正式 v3.2.2 基线 | 09-28 独立候选 |                   减少 |
| ----------------------------------------- | ---------------: | -------------: | ---------------------: |
| NSIS 安装包                               |       199.58 MiB |     163.63 MiB |  35.94 MiB（约 18.0%） |
| 安装后文件总量                            |       582.28 MiB |     464.10 MiB | 118.18 MiB（约 20.3%） |
| `app.asar`                                |        87.60 MiB |      47.97 MiB |              39.63 MiB |
| `app.asar.unpacked`                       |        79.70 MiB |       0.74 MiB |              78.96 MiB |
| Production `node_modules`（归档逻辑大小） |       137.49 MiB |      20.87 MiB |             116.63 MiB |

安装后文件的物理分类核算通过；预算为安装包 185 MiB、安装后 520 MiB、`app.asar` 80 MiB，候选均低于阈值。只有一份 FFmpeg，原始 Renderer 库副本为 0 MiB；非 Windows x64 的 `uiohook` 插件、工作区 TypeScript 源码和 CloudBase 小程序文件均为 0。Electron locales 仅 `en-US` 与 `zh-CN`。包内 CloudBase 配置、AI runner 哈希、两项原生辅助程序、DeepFilter、98 个字体文件、47 个 AAC 和许可文件校验通过，Windows 执行级别检查通过。

这是一份静态打包及自动校验证据；没有安装候选包，也没有把五人真实通话、手机麦克风远端听感、旧版客户端更新或登录/快捷键实际交互宣称为通过。

生产依赖按进程用途复核：`semver` 供主进程更新判定，`ws` 供通信，CloudBase 与 Supabase 各承担仍在使用的账号路径；`lucide` 的动画图标与 `lucide-react` 的普通图标都存在源码调用，`morphicons`、`uisfx`、`react-virtuoso` 和动态加载的 `qrcode` 也有实际 Renderer 入口。此轮没有把仍被使用的直接依赖伪称为“已删除”；主要收益来自打包时排除 Renderer 原始副本、重复 FFmpeg 和无关平台文件。

后续核查发现根工作区的 Turbo 配置与开发依赖没有任何脚本或 CI 调用，实际构建和检查均由 pnpm 执行；已移除这项闲置开发工具及配置，并只从锁文件删除 Turbo 及其平台二进制条目。这不改变 production 依赖，也不计入 Windows 安装包减重。

## 2026-09-29 长期下载占用复核

只读统计当前 `%LOCALAPPDATA%/ShangHao/AI`：276,300 个文件，共约 69,568.28 MiB；其中一份 `.part` 续传文件约 2,637.99 MiB，最后修改约 46 天前。该文件可能用于继续下载，不能只按年龄判定无用；本轮没有删除、移动或重置任何模型、Runtime 或下载片段。它也不计入安装包体积。

模型与可选 Runtime 下载现在在每个数据块写盘前核对清单中的预期大小；超过上限的响应会被拒绝，不能继续扩大 `.part`。模型清单中的非有限、负数和非整数大小不再进入下载队列，可选 Runtime 也先验证预期大小。两种超量响应及非法大小的定向测试通过。现有 `.part` 继续保留供续传，真实长期磁盘增长需要后续观察。

可选 Runtime 目标文件在替换包下载、大小和 SHA-256 校验完成前继续保留；网络失败不会先删除已有包。隔离临时目录中的失败和替换测试通过。已有 `.part` 仍供续传，本轮没有清理真实下载缓存。补充的双进程同名 1 MiB 假源下载连续六轮均得到唯一且哈希正确的成品，无 `.part` 残留；这不等同于真实网络故障或跨版本并发验证。

## 2026-09-29 v3.3.0 本机发布候选

按正式发布流程在仓库的 `apps/desktop/release` 目录完成 Windows x64 NSIS 打包，执行包内容校验、执行级别检查、校验和生成及预算检查。[候选报告](package-size-candidate-v3.3.0.json)记录本机产物的文件分类和最大文件。

| 项目                                      | v3.2.2 正式基线 | v3.3.0 本机候选 |                    变化 |
| ----------------------------------------- | --------------: | --------------: | ----------------------: |
| NSIS 安装包                               |      199.57 MiB |      163.69 MiB |  -35.88 MiB（约 18.0%） |
| 安装后文件                                |      582.28 MiB |      464.46 MiB | -117.82 MiB（约 20.2%） |
| `app.asar`                                |       87.60 MiB |       48.33 MiB |              -39.27 MiB |
| Production `node_modules`（归档逻辑大小） |      137.49 MiB |       21.14 MiB |             -116.35 MiB |

本机候选低于 185 MiB 安装包、520 MiB 安装后文件及 80 MiB `app.asar` 预算；唯一 FFmpeg、AI Runner、字体、DeepFilter、快捷音频、原生助手和许可检查通过。GitHub Actions 将在 v3.3.0 标签上再次构建并附带其实际包体积报告；CI 产物报告才是 GitHub Release 的最终构建记录。此候选没有安装到日常使用环境，也不代表旧版升级、登录和真实设备验收。
