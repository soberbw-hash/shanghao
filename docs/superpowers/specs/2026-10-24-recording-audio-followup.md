# 录音库、共享声音与开发入口续作（2026-10-24）

本地候选仍为 3.4.13；未提交远端、发布、部署或打包 EXE。用户数据和已有修改保留。此记录替代较早“窗口预览”的设计描述。

## 用户随后追加的同轮调整

- 放歌：入口改名“放歌”，只允许 QQ音乐、网易云音乐、Apple Music、Spotify、酷狗、酷我、汽水等已知音乐应用。Main 枚举与启动复核都采用相同进程名白名单；Renderer 同样过滤旧 Main 返回的普通应用。浏览器进程可能还含其他标签页与通话，因此不作为音乐来源。音乐链接卡片能力保留；不绕过各平台账号、版权或播放权限。音乐应用的通知也可能随该进程输出一并分享，不承诺只抓歌曲本身。
- 账号：SDK 自动轮换凭据后同步 Main；刷新 single-flight，防止并发重复使用刷新凭据；Relay 明确拒绝鉴权时不再用本地 profile 掩盖；登出/换账号/换服务器后迟到刷新不写回；Renderer 旧快照不覆盖新账号事件。私人房间只对明确 401/account_session_expired 强制刷新并重试一次，网络失败不重发操作。正式旧版必须后续更新才获得本地代码修复，本次没有替换其安装内容。
- 文字稿：14px 正文、22.4px 行高、紧凑时间与说话人列；单行段约 34.4px，夹具首屏可浏览 20 段。变高虚拟列表继续按实际高度测量，保留键盘连续浏览和逐句回听。
- 摘要：pipeline 6 优先具体事件、人物原话和反转，允许有证据的调皮吐槽，过滤已知空泛套话及无出处引语；不编名字、矛盾或人物关系。旧成功摘要不因版本变化批量重跑，重试摘要不重传音频。
- 恢复与融合：可信 catalog 读取时尝试恢复旧路径稿件到稳定 ID，要求路径、录制时间和文件修改时间三证据齐全；稳定 ID 已有结果优先，原子 CAS 避免并发覆盖，无法确认身份显示只读提示并保留旧稿。已完成转录的恢复不再重跑 ASR；已有双稿时可继续融合。全未校对结果标记失败并回到云端原稿，不伪装融合成功；真实已核对显示句数，能与身份匹配的本地原稿逐句对照且无改字时才显示“无文字修改”。

本节最终整合：`artifacts/latest-user-batch-smoke.log` 1462 总项、1457 通过、5 跳过、0 失败（122.08 秒）；`latest-user-batch-typecheck.log`、`latest-user-batch-eslint.log` 退出 0；`latest-user-batch-main-build.log`、`latest-user-batch-renderer-build.log` 构建成功，ratchet 与 diff check 通过。新增身份恢复、摘要、融合、账号回归均纳入此数，尚待本批独立复审。

当前截图：`artifacts/music-picker-layout.png`（演示图标，非真实音频采集），Temp/shanghao-recording-feedback-images-ea4KRz/recording-library-dense.png（实际组件、合成文字）。

## 用户反馈与本次实现

- 录音库：存储栏压缩为 36px 设置入口；摘要使用单行展开，失败可重试；工具与模型设置集中，文字稿提前，正文 15px。来源与时间精度保留；不删除暂停、片段、标记、回听等能力。
- 摘要后台：摘要及融合不再读取当前房间的问答记忆；只处理所属录音原文。新 ASR 排队不再按本地模型抢占规则中断云端文本任务；显式暂停继续有效。legacy local 文本设置的摘要改走已配置 HTTPS 文本服务，缺配置给出错误，不冒充本地生成。问答仍严格隔离房间。
- 共享声音：原生顶层 dialog、应用图标与名称列表，彻底移除窗口画面读取与大预览区。图标从原生枚举的本机 exe 提取；进程身份复核、超时降级、opaque source ID 保留。分享/取消/停止与独立音量不变。
- 电话模式：进入系统静音前播放开启提示；确认恢复输出后播放退出提示。重复同步、失败和初次读取不重复响，遵守界面音量。
- 临时联机：删右侧免登录说明；单排频道 SVG 头像及上传入口；创建由服务生成随机八位码，加入已有码独立呈现。
- 开发版：重建桌面及开始菜单“上号开发版”入口，脚本路径带引号；品牌图标按内容 hash 固定保存并原子写入。旧自有快捷方式备份后退役，不改正式版入口。2026-10-24 13:34 从该入口启动，Main PID 42064、Responding=true，激活日志 activated=True。
- 临时房间并发：提交 checkpoint 等待真实 lease tick 完成，并在旧多数确认 install 前阻止更高 sequence 发布；迟到 signer 不覆盖新 checkpoint。可达多数正例和不可达多数拒绝负例均保留。

## 验证证据

- `artifacts/continuation-batch-smoke.log`：1429 总项，1424 通过、5 跳过、0 失败（118.96 秒）。
- `artifacts/continuation-batch-rust.log`：17/17。
- `artifacts/continuation-batch-typecheck.log`、`continuation-batch-eslint.log`：退出 0。
- `artifacts/continuation-batch-main-build.log`、`continuation-batch-renderer-build.log`：构建通过；Main 产物隔离在 artifacts，未清理运行中的 Main。
- architecture ratchet、git diff check 通过；Impeccable 对本次主要界面检测 `[]`，仅作为机械检查。
- `artifacts/continuation-final-five-peer-audio.log` 与 `continuation-final-five-peer-media.log`：五人音频/媒体通过。
- 早期通用应用元数据探针提取过 9/9 图标，不采集音频或画面。用户改为音乐专用后，同一探针重新核验返回 0 个来源（当时没有匹配的运行中音乐应用），`artifacts/application-audio-native-icons.json` 当前为空数组；不能继续把该文件称为 9 个音乐应用的证据。写出的列表只含假 ID、进程名和图标，不含 exe 路径。
- CUA 在隔离浏览器组件验证：顶层、窄窗口、取消和选择；合成 PCM 经真实 Worklet 输出 RMS 0.061、attached=true，停止后移除轨道。未发送用户音频。
- 图片：`artifacts/application-audio-icons-desktop.png`、`application-audio-icons-narrow.png`。录音库实际组件隔离截图位于 Temp/shanghao-recording-feedback-images-8bQKID，临时入口位于 Temp/shanghao-temporary-entry-Ms9mVE。

## 实际边界

配置的自定义 HTTPS 文本服务可在离房后处理录音摘要；内建 signaling cloud 路由仍要求对应活动房间，本次没有新增或部署服务端离房接口。不得把两种入口混为“所有云端无房间依赖”。

本次后台回归使用真实服务模块、隔离存储和受控 HTTPS 响应，没有重新向真实 AI 服务上传用户录音或读取用户密钥。未验证真实耳机中提示音的听感、远端收到指定程序声音、游戏全屏、双机异网与 60 分钟耐久。WindowsApps exe 可能提供通用 OS 图标，缺图标时正常降级，不能伪造品牌。

本批经“上号审核”集中只读复核，发现的唯一 P1 已在有界复核中关闭。独立复核运行了 51 项专项；另 1 项 loopback WebSocket 因该审核环境 EACCES 受阻，不记为独立通过。主任务相应隔离 HTTP/WS 检查已通过。审核不代表发布授权。

集中复审发现 P1：复制到稳定 ID 后无条件删源，两步之间另一进程保存的旧编号新稿可能丢失。已用两实例真实 SharedVoiceMemoryStore 落盘回归重现后删除该删除步骤，保留源与稳定快照。`artifacts/migration-source-race-red.log` 记录旧实现失败；修后 `migration-source-race-green.log` 24/24（恢复、共享存储、队列及 service），类型/定向 ESLint/ratchet/diff check 和 Main 构建通过。前述 1457 整合通过属于该最小修复前的基线，不称为修后全量。“上号审核”独立重跑原合成竞态，确认删除调用为 0、较新源稿保留，P1 已关闭；未在审核环境独立重跑跨实例落盘测试。

开发版最后一次实际启动的 PID 为 42064，最新 Main 修改需安全重开后加载。已向用户询问当前是否通话/录音，未收到新的重开确认，未强行中断。正式旧版未替换；暂停发布。

旧音频元数据没有内容 hash/原生 fileId 时，即使三证据一致，也无法辨别人为保留全部时间元数据的替换；catalog 自身按文件名复用已有 stable ID 的历史行为也未在本次变成不可变音频身份。此项不能宣称内容身份已得到完整证明。
