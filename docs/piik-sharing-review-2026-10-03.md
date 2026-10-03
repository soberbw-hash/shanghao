# Piik 分享交互参考

用户要求自行判断适合上号的功能，完成后再发布。参考对象为 [Piik](https://github.com/TNTcraftHIM/Piik)。

## 本次采用

Piik 的[使用指南](https://github.com/TNTcraftHIM/Piik/blob/main/docs/guide/getting-started.zh-CN.md)与[来源选择组件](https://github.com/TNTcraftHIM/Piik/blob/main/src/client/components/living/CaptureSourcePicker.tsx)把来源、预览和声音选项放在开始之前。上号据此重新组织现有屏幕来源选择器：

- 应用窗口／整个屏幕分组，点击只选择，预览后明确开始。
- 显示清晰度和系统声音，声音默认关闭，明确整台电脑音频的范围。
- 刷新保留本次选项；失效来源禁止确认；重复确认只调用一次。
- 在选择器提供已有的私人房间邀请复制入口。
- 原生模态焦点、Escape 关闭，窄窗口正文滚动而开始按钮保持可见。

代码由上号自行实现，没有复制 Piik 源码。ScreenCaptureService 和 ScreenShareManager 的捕获／Track 所有权保持原有设计。

## 留作后续需求

浏览器免安装观看需要单独的观看授权、过期令牌和房间权限设计，本次未添加公共观看入口。应用独立音频需要原生进程音频捕获与实际设备验证，本次沿用系统声音能力。Piik 的[自动路由 ADR](https://github.com/TNTcraftHIM/Piik/blob/main/docs/adr/0005-automatic-hybrid-media-routing.md)面向更多观看者；上号目前是五人语音房，不因参考交互而重写已验证的媒体拓扑。

实现与隔离界面证据见本版发布核对记录；实际跨设备画面和系统声音仍单独验收。
