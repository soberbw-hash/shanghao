# 动效职责边界

上号保留 GSAP、Framer Motion 和 CSS，但三者不重复控制同一个属性。

## GSAP

- 页面进入、频道入场、敲一下等需要严格编排先后顺序的时间轴。
- 一次性的场景反馈和多元素协调动画。
- 动画退出时必须清理 timeline，不能遗留全局 ticker。

## Framer Motion

- 座位切换、角色移动、弹窗和布局变化等需要随时打断并从当前位置继续的动画。
- 按钮按压、消息插入、状态胶囊切换等声明式组件反馈。
- 所有弹簧从共享 motion token 读取，不在组件内复制一套手写参数。

## CSS

- 呼吸、环境光、图标声波等低幅度、低频率、无需 JavaScript 状态的循环。
- 只过渡 `transform`、`opacity`、颜色和阴影，不使用 `transition: all`。
- `prefers-reduced-motion` 下停止常驻循环并缩短非必要反馈。

## 性能边界

- 同一个节点的 `transform` 不可同时由 GSAP、Framer Motion 和 CSS 控制。
- 不对全屏 `backdrop-filter`、`filter` 或布局属性做逐帧动画。
- 游戏运行时优先保证语音和屏幕分享；装饰动画不能创建额外 AudioContext 或媒体流。
