# 房间与账号修复阶段验收 — 2026-09-17

## 2026-09-19 v3.0.11 流畅性与稳定性专项验收

本轮视觉真值仍为 `C:/Users/sober/Desktop/Codex 图像 2026年9月16日 22_12_17.png`（2048×1280）；当前实现截图为 `output/playwright/room-v3.0.11.png`（2048×1210）。两者已放入同一对比输入 `output/playwright/room-comparison.png`，未做像素密度缩放补偿。参考图是纯房间夜景，当前实现是带应用外壳的晴天视觉 fixture，因此只核对共享构图、层级和材质，不把天气状态与外壳差异计为缺陷。

全局核对结果：五个工位仍保持上三下二且间距合理；地毯、顶部窗帘、左下前景叶、门角遮挡、右侧植物/猫灯、书架、日历和时钟的空间关系与参考方向一致。桌面组件融入环境，显示器保持正常对比度；角色和状态牌没有破坏下排工位层级。聊天设置按钮仍位于标题行右侧并保留内边距。本轮性能拆分没有引入新的 P0、P1 或 P2 视觉回归。

焦点核对：真实 Electron 设置页截图为 `output/playwright/settings-56-switch.png`（2547×1602）。预热所有分区后连续切换 56 次，DOM 节点从 2339 到 2339，峰值 2704；平均切换 30.13ms，P95 45.77ms。最终截图中导航、内容卡片、返回按钮、版本信息均无裁切、重叠或残影。开发性能采样会保留交互记录，因此 JS 堆从约 81.0MiB 增至约 94.1MiB；DOM 稳态不增长，未观察到页面实例持续累积。

发现项：

- P3：参考图为夜景、实现 fixture 为晴天，属于刻意状态差异；动态天气已有独立回归，不要求本次强制同一状态。
- P3：当前完整应用截图比纯房间参考多顶部、聊天与底栏外壳，属于产品布局而非房间素材偏差。

Final result: passed

## 2026-09-18 增量验收（以下旧阶段记录保留）

本次按用户最新反馈完成：上三下二桌位横向展开（28/50/72、36/64），下排 y=69；角色上移到桌沿前，状态牌恢复底部。30 条有向行走路径采样和布局测试通过。当前模拟页截图中上排状态牌与下排显示器没有相交。

最终小幅调整：五桌、角色与门统一下移 3 个场景百分比，柜子 bottom 从 10% 改为 7%。最终桌位 y 为 40/37/40/72/72，角色 y 为 38/35/38/70/70，门 y=71。保持水平间距、比例与角色遮桌沿关系；该调整后 31 项布局/路径测试通过，浏览器截图确认状态牌仍在底部且未挡下排屏幕。

采用 imagegen 内置工具生成上下扩展画布，加入左下前景植物及右侧植物/猫灯；不是把原房间拉伸，也没有烘焙交互家具。环境图与家具共享等比例坐标，扩展区域超出容器时裁切。桌位编号只随本桌 hoveredZone 显示。家具降低亮度/饱和度并加强柔和投影。

素材：`apps/desktop/src/renderer/src/assets/scenes/shanghao-room/environment-v3-extended.png`。原始 v2 保留。生成提示：以 environment-v2 为编辑目标、用户 22_12_17 原图为风格参考，保持中央 1584×992 房间比例，向上下各延展 144px 蓝墙和木地板；仅补右侧盆栽、奶油色猫灯、左下虚化前景叶；不得生成桌子、电脑、窗户、门、柜子、日历和时钟，不加文字。

找回密码现在打开即显示验证码、新密码、确认新密码；仍要求成功发送挑战后才能提交，未发送真实短信、未改任何真实密码。1280×720 模拟页中完整表单可见。

验证：582 smoke 通过；类型检查通过；renderer 生产构建通过（背景已改为模块导入以保证打包）；Rust 两项测试通过。后续桌位微调另跑 31 项布局/角色路径测试通过。

已通过 winget 安装 Microsoft Visual Studio 2022 Build Tools 的 VCTools 推荐组件；Rust release 编译成功。完整 workspace build 仍被运行中的 ShangHao.PhoneAudio.exe 文件占用阻挡，未强杀隐私静音服务、未关闭用户软件。没有打包 EXE、发布或部署。

Final result: **blocked for exact-reference/full-release acceptance**。当前局部视觉问题已在独立 TeamIsland 模拟页检查，但不是完整联网五人窗口验收，也没有完成逐像素一比一验收。最新布局遵照用户后续的桌位展开要求，已不再与原始坐标完全一致。旧阶段的“尚未生成背景”描述已由本增量记录取代。

Final result: **blocked** — 尚未达到用户要求的参考图一比一，不作为视觉完成验收。

## 参考与实现

唯一视觉参考：`C:/Users/sober/Desktop/Codex 图像 2026年9月16日 22_12_17.png`。
家具继续是独立 DOM，未把完整参考图铺成背景，未重新生成用户家具。
当前 CSS 墙、地板、地毯已经分层，但材质、光照和空间质感仍与参考图有明显差距。
待用户选择是否允许制作去家具的背景层；未经确认没有生成或替换背景图片。

| 元素         | 实现位置（apps/desktop/src/renderer/src/ 下） | 当前定位                                          |
| ------------ | --------------------------------------------- | ------------------------------------------------- |
| 桌子和显示器 | components/room/WorkstationArt.tsx            | 五个独立桌位，同一 PNG                            |
| 窗户         | components/room/DynamicWeatherWindow.tsx      | 左 3%，上 -3%，宽 34%；短窗口 29%                 |
| 日历         | components/room/RoomDateCalendar.tsx          | 左 49%，上 3%，宽 8%，保留动态日期                |
| 时钟、门     | components/room/SceneAmbientDecor.tsx         | 时钟右 12%/上 4%/宽 10%；门中心 11%/78%           |
| 柜子         | components/room/RoomCollectionShelf.tsx       | 右 3%，下 5%，宽 18%                              |
| 坐标         | features/voice-scene/sceneZones.ts            | (31,34)、(50,29)、(69,34)、(40,68)、(61,68)       |
| 样式         | styles/parts/180-room-asset-pass.css          | 地毯左 19%/上 28%/宽 64%/高 59%，统一独立素材比例 |

修正了时钟和日历素材映射、显示器覆盖尺寸、重复城市图层、门的边界与地面遮挡。
删除的是重复窗户装饰 DOM；没有删除用户原图或资源文件。旧兼容样式仍保留并通过局部样式覆盖。
顶部、聊天边框、底栏做了轻量密度调整，没有改变功能顺序；完整真实 RoomPage 的外围界面仍需回归。
没有改座位业务身份或运动算法，仅调整目标几何位置并补充路径测试。

## 已执行的验证

- 类型检查：通过。
- 桌面 smoke：581/581 通过。
- git diff --check：通过。
- 真实 TeamIsland 组件的本地模拟页：1280×720、1440×900、1920×1080 均人工查看；家具未见拉伸，门完整显示。
- 模拟页点击换位、离开；最后观察到角色到达门前，原座位屏幕熄灭。
- 路径单测覆盖六个区域之间 30 条有向路径的采样，检查无关桌位碰撞。
- 以上不等于多人联网、全部人物同时移动、真实设备或低概率抽搐问题完全消除。
- 现有 output/playwright 图片是较早中间稿；最新检查依据为内置浏览器截图，不以旧截图冒充最终效果。

## 密码重置

已补充发送后验证码、新密码、确认密码、重新发送倒计时和服务端完成请求。
CloudBase 的重置挑战绑定接收目标、设本地过期时间，成功后消费；错误验证码允许重试。
模拟服务界面确认发送后显示三项输入。单测通过；未发送真实短信或改动任何真实账号密码。

## 2.txt 性能工作进度

## 2026-09-18 增量验收（以下旧阶段记录保留）

本次按用户最新反馈完成：上三下二桌位横向展开（28/50/72、36/64），下排 y=69；角色上移到桌沿前，状态牌恢复底部。30 条有向行走路径采样和布局测试通过。当前模拟页截图中上排状态牌与下排显示器没有相交。

最终小幅调整：五桌、角色与门统一下移 3 个场景百分比，柜子 bottom 从 10% 改为 7%。最终桌位 y 为 40/37/40/72/72，角色 y 为 38/35/38/70/70，门 y=71。保持水平间距、比例与角色遮桌沿关系；该调整后 31 项布局/路径测试通过，浏览器截图确认状态牌仍在底部且未挡下排屏幕。

采用 imagegen 内置工具生成上下扩展画布，加入左下前景植物及右侧植物/猫灯；不是把原房间拉伸，也没有烘焙交互家具。环境图与家具共享等比例坐标，扩展区域超出容器时裁切。桌位编号只随本桌 hoveredZone 显示。家具降低亮度/饱和度并加强柔和投影。

素材：`apps/desktop/src/renderer/src/assets/scenes/shanghao-room/environment-v3-extended.png`。原始 v2 保留。生成提示：以 environment-v2 为编辑目标、用户 22_12_17 原图为风格参考，保持中央 1584×992 房间比例，向上下各延展 144px 蓝墙和木地板；仅补右侧盆栽、奶油色猫灯、左下虚化前景叶；不得生成桌子、电脑、窗户、门、柜子、日历和时钟，不加文字。

找回密码现在打开即显示验证码、新密码、确认新密码；仍要求成功发送挑战后才能提交，未发送真实短信、未改任何真实密码。1280×720 模拟页中完整表单可见。

验证：582 smoke 通过；类型检查通过；renderer 生产构建通过（背景已改为模块导入以保证打包）；Rust 两项测试通过。后续桌位微调另跑 31 项布局/角色路径测试通过。

已通过 winget 安装 Microsoft Visual Studio 2022 Build Tools 的 VCTools 推荐组件；Rust release 编译成功。完整 workspace build 仍被运行中的 ShangHao.PhoneAudio.exe 文件占用阻挡，未强杀隐私静音服务、未关闭用户软件。没有打包 EXE、发布或部署。

Final result: **blocked for exact-reference/full-release acceptance**。当前局部视觉问题已在独立 TeamIsland 模拟页检查，但不是完整联网五人窗口验收，也没有完成逐像素一比一验收。最新布局遵照用户后续的桌位展开要求，已不再与原始坐标完全一致。旧阶段的“尚未生成背景”描述已由本增量记录取代。

Final result: **blocked** — 尚未达到用户要求的参考图一比一，不作为视觉完成验收。

## 参考与实现

唯一视觉参考：`C:/Users/sober/Desktop/Codex 图像 2026年9月16日 22_12_17.png`。
家具继续是独立 DOM，未把完整参考图铺成背景，未重新生成用户家具。
当前 CSS 墙、地板、地毯已经分层，但材质、光照和空间质感仍与参考图有明显差距。
待用户选择是否允许制作去家具的背景层；未经确认没有生成或替换背景图片。

| 元素         | 实现位置（apps/desktop/src/renderer/src/ 下） | 当前定位                                          |
| ------------ | --------------------------------------------- | ------------------------------------------------- |
| 桌子和显示器 | components/room/WorkstationArt.tsx            | 五个独立桌位，同一 PNG                            |
| 窗户         | components/room/DynamicWeatherWindow.tsx      | 左 3%，上 -3%，宽 34%；短窗口 29%                 |
| 日历         | components/room/RoomDateCalendar.tsx          | 左 49%，上 3%，宽 8%，保留动态日期                |
| 时钟、门     | components/room/SceneAmbientDecor.tsx         | 时钟右 12%/上 4%/宽 10%；门中心 11%/78%           |
| 柜子         | components/room/RoomCollectionShelf.tsx       | 右 3%，下 5%，宽 18%                              |
| 坐标         | features/voice-scene/sceneZones.ts            | (31,34)、(50,29)、(69,34)、(40,68)、(61,68)       |
| 样式         | styles/parts/180-room-asset-pass.css          | 地毯左 19%/上 28%/宽 64%/高 59%，统一独立素材比例 |

修正了时钟和日历素材映射、显示器覆盖尺寸、重复城市图层、门的边界与地面遮挡。
删除的是重复窗户装饰 DOM；没有删除用户原图或资源文件。旧兼容样式仍保留并通过局部样式覆盖。
顶部、聊天边框、底栏做了轻量密度调整，没有改变功能顺序；完整真实 RoomPage 的外围界面仍需回归。
没有改座位业务身份或运动算法，仅调整目标几何位置并补充路径测试。

## 已执行的验证

- 类型检查：通过。
- 桌面 smoke：581/581 通过。
- git diff --check：通过。
- 真实 TeamIsland 组件的本地模拟页：1280×720、1440×900、1920×1080 均人工查看；家具未见拉伸，门完整显示。
- 模拟页点击换位、离开；最后观察到角色到达门前，原座位屏幕熄灭。
- 路径单测覆盖六个区域之间 30 条有向路径的采样，检查无关桌位碰撞。
- 以上不等于多人联网、全部人物同时移动、真实设备或低概率抽搐问题完全消除。
- 现有 output/playwright 图片是较早中间稿；最新检查依据为内置浏览器截图，不以旧截图冒充最终效果。

## 密码重置

已补充发送后验证码、新密码、确认密码、重新发送倒计时和服务端完成请求。
CloudBase 的重置挑战绑定接收目标、设本地过期时间，成功后消费；错误验证码允许重试。
模拟服务界面确认发送后显示三项输入。单测通过；未发送真实短信或改动任何真实账号密码。

## 2.txt 性能工作进度

本阶段只完成录音混音同步的依赖收敛：成员 speaking、延迟、位置更新不再触发 mix.sync。
拓扑、流、音轨及参与者身份变化仍触发同步；媒体事件和 store 订阅卸载时清理。
纯函数测试模拟 1000 次 speaking/延迟/位置更新，均被依赖守卫过滤。这不是真实设备性能提升百分比或 React Profiler 结果。
未完成：整页渲染剖析、时间线压缩、共享参与者索引、日志/聊天批处理、完整 IPC 和内存回归。
未为视觉任务更改 WebRTC、AEC、VAD 或采样率；没有发布、打包或部署。

# Room glass visual QA — 2026-09-25

Reference: the user's September 19 glass-room screenshot (inside the app frame only), compared with the annotated current-state screenshot supplied in the same request.

- At a 1984×1272 desktop viewport, the room-scene/chat join is continuous: inner corners are square, outer corners stay rounded, and the two concave white gaps are gone.
- The chat background uses layered cool-blue and warm reflected-light gradients with backdrop blur; the previous near-opaque white material rule is explicitly overridden. Message text and controls remain crisp.
- Top bar and bottom dock use the same softened translucent material. The room illustration itself is not blurred or stretched, and nothing outside the application frame was changed.
- A 980px breakpoint restores separated rounded panels for narrow layouts.
- Source review and in-app browser visual fixture completed. The isolated Electron room capture stopped at account login because the configured relay disallows guest access, so a logged-in production-window screenshot is still a physical QA item.

## 2026-09-25 glass and chat follow-up

- Source visual truth: `C:/Users/sober/AppData/Local/Temp/codex-clipboard-08a4361c-0bcb-4f34-8609-75cca8522de6.png` (1984×1275 reference material); current-state comparison: `codex-clipboard-58d87406-c63d-43a4-9216-9f2a5b14097c.png` (2457×1580). The user explicitly excluded old proportions from the comparison.
- Implementation: `http://127.0.0.1:5173/room-visual-check.html`, in-app Browser capture in this task, viewport and CSS size 1984×1275 at 1×. This is a live component fixture, not a signed-in production RoomPage screenshot; the capture was displayed inline and not persisted to a file.
- Full view: room scene remains sharp; chat uses a lighter frosted substrate with separate edge highlight, header, content cards and composer layers. No extra whitespace gap appears between the scene and chat.
- Focused region: in-app Browser 240×620 clip at the scene/chat join shows no independent white border; the remaining transition is a soft 88px colour wash. Chat text and buttons remain sharp. At the same viewport, six fixture message rows have measured vertical gaps of 12–13px, including grouped messages and a URL preview.
- Earlier P1 findings: chat panel was too solid blue and the join had a hard white vertical line. Earlier P2 finding: grouped chat rows were pulled 5px closer by a negative margin, while image/link margins made rhythm uneven. Fixes: more translucent neutral material, overlapping join by 8px, remove left border/left inset highlight, change grouped-row margin to zero, replace list `space-y` with 12px flex gap and align media spacing. Post-fix focused capture and DOM measurements above verify those local issues.
- Fonts/copy: retained existing Noto Sans SC stack, labels and content; no type, size or proportion change. Colour: blue tint reduced while preserving contrast. Imagery: original room asset retained and unblurred. Spacing: only chat-message rhythm and join overlap changed.
- `final result: blocked` for production-window fidelity: the signed-in room could not be opened in isolated Electron capture because the relay disallows guests. The live component fixture passes the scoped visual checks; real account-window comparison remains required.

## 2026-09-25 join softening

- The user marked the vertical scene/chat transition as too visible. At the same 1984px reference-width fixture, added a 42px masked frosted wash only over the scene's right edge; the chat still overlaps by 8px and retains a crisp reading surface.
- Rechecked the live in-app Browser capture after CSS hot reload: the right-edge plant now fades into the glass instead of ending at an unsoftened straight cut. No scene scaling, external-window treatment, or chat-content blur was introduced. The narrow-layout breakpoint disables the wash when panels separate.
- `final result: blocked` remains for signed-in production-window fidelity and physical device acceptance; this capture is the live component fixture, not the authenticated app.

## 2026-09-25 floating material and microphone shortcut

- Reference: the user's music-hint screenshot is the material target; clock hint, character label, and microphone popover were the inconsistent current surfaces. Kept the existing room proportions and scene imagery.
- Unified the small floating surfaces around a translucent cool-blue fill, 18px backdrop blur, fine white rim, inset top highlight, and soft outer shadow. The larger microphone popover uses the same material hierarchy with 24px blur and lighter inset option cards so controls stay legible.
- Added a direct “手机麦克风” action beside the bottom restore action in the microphone popover, while preserving its device-list entry. The live component fixture at 1440×900 showed the action and a two-member scene; computed microphone material was `rgba(235,246,255,0.84)` with `blur(24px)`.
- `final result: blocked` for authenticated production-window and physical two-client fidelity. The local browser fixture confirmed layout and both character elements, but does not reproduce every reconnect/animation timing or real multi-device session.

## 2026-09-25 room perimeter, header spacing, and window motion

- References: `codex-clipboard-247d5b31-fead-4904-89ac-ab6dcd739fac.png` for the chat-header gap, `codex-clipboard-8ad27e42-ce0b-4ea8-b6ff-5df334fe48eb.png` for the wall above the window, and `codex-clipboard-9bdceb4f-e7d1-4631-a177-be54b66955cd.png` for the room UI perimeter. The marked rectangles identify problems, not exact dimensions to reproduce.
- Reduced the chat panel's top padding and header spacing, and removed the redundant header highlight. The quick replies remain immediately below the title and the message/composer separation is retained.
- Raised the independent window element from `top: -7%` to `top: -11.5%` without resizing the room illustration or moving the city separately. Existing weather art, rain, snow, fog, and lightning remain. Clear weather now also renders one low-opacity drifting cloud; cloud motion uses a container-relative compositor transform, while the landscape stays anchored.
- Tuned the entire page's depth hierarchy: the app frame and title bar remain the quiet outer material; the room status bar and voice dock cast opposing low-opacity shadows; the joined scene/chat region owns one perimeter shadow; individual scene and chat shadows were reduced to avoid stacked heavy edges. Existing small control and message surfaces retain lighter local elevation.
- Live in-app Browser fixture at `http://127.0.0.1:5174/room-visual-check.html` was reviewed at a wide layout before the last shadow pass and at a 783px narrow layout after the pass. The narrow layout keeps separate rounded scene/chat panels; no text or scene blur was introduced. The fixture is synthetic and does not include the authenticated production top bar or every chat state.
- Weather motion continues to pause under page invisibility/reduced-motion through `DynamicWeatherWindow` and the scene animation rules. Static source assertions cover the clear-weather cloud path and existing visibility gating. Test and build outcomes are recorded separately in the task response.
- `final result: blocked` for pixel-level authenticated production-window fidelity and on-device animation assessment; the browser fixture and source checks do not substitute for those captures.

## 2026-09-25 quick-message card edge

- Source visual truth: `C:/Users/sober/AppData/Local/Temp/codex-clipboard-cf918f1a-5d89-4876-a78b-78c3e280a9f7.png`, 796×270 crop of the signed-in chat header. Its abrupt lower divider and square inset are the defects to remove, not styling to reproduce.
- Implementation: live `http://127.0.0.1:5174/room-visual-check.html` in in-app Browser tab 5. The implementation screenshot was viewed inline at 1984×1279 CSS px, 1× density, with a 550×160 focused chat-header crop; it was not persisted to a file. Also reviewed at the default 694px narrow viewport. Fixture content differs from the signed-in source, so the comparison is limited to card geometry and material.
- Earlier P2: the quick-message area ended in a full-width straight line without its own closed frame. Fix: inset the header 2px, give it a continuous 16px radius and one-pixel border, retain translucent fill and contained shadow. Post-fix wide and narrow captures show all four corners and no cropped buttons; narrow music actions wrap within the card.
- Typography and copy: existing type stack, labels, and button contents unchanged. Spacing: 10–12px internal padding with existing row gaps; no added broad gap below. Colors: existing cool-blue/white glass tokens retained. Image quality: no image assets in this card. No additional icon assets introduced.
- The isolated fixture cannot verify authenticated-room data or every window size, but no P0/P1/P2 differences remain for the scoped rounded-card request.
- `final result: passed` for this scoped visual change.

## 2026-09-26 room-glass and short-window follow-up

- Compared the user's iOS dock screenshots for material qualities only: quiet cool-blue translucency, a fine light rim, a restrained inner dark edge, and a soft outer shadow. Retained ShangHao's existing room proportions, typography, illustration, and controls. The room status bar and voice dock now share one glass hierarchy; the chat header remains a separate rounded inset card rather than a clipped divider.
- Reduced the extra full-height backdrop blur on the chat panel. Its enlarged, blurred room-wallpaper layer remains behind sharp message text and controls. This removes one costly compositing layer by construction; no measured CPU/GPU improvement is claimed.
- The independent window frame, calendar, and clock use room-scene aspect-ratio rules to avoid the coordinate canvas's top crop in short/wide windows. Live component fixture checks at 1024×768, 1280×720, 1440×900, 1600×900, 1920×1080, and 1920×700 found the calendar and clock top edges inside the scene; the window's visible frame also remained inside it. The frame PNG has transparent padding above its visible rim, so the element rectangle itself can extend above the scene without visible clipping.
- Verified the local `room-visual-check.html` fixture in the in-app browser at 1280×720 and 1920×1080 after hot reload. Screenshots were displayed inline, not persisted. This fixture has synthetic members/messages and simplified chrome; it is not an authenticated production-window capture.
- Typecheck, renderer production build, main/preload `tsup` build, `git diff --check`, and all 606 desktop smoke tests passed. The shutdown regression test now covers duplicate `before-quit` events and rejects new phone-mode writes after shutdown. The user's earlier `ERR_STREAM_WRITE_AFTER_END` native popup was not reproduced on a real Electron exit in this run.
- `final result: blocked` for exact signed-in production-window comparison, real Windows close/switch stress, and measured before/after UI frame time or GPU memory. No physical phone or multi-peer acceptance is inferred from the fixture.
