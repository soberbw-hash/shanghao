# 电话模式全屏按键诊断与补强

用户现象：LOL 全屏按快捷键完全没有反应，也没有进入提示音。故障首先定位在输入触发阶段，尚不能认定是系统音频静音失败。

## 本机证据

- 检查时开发版 Main 与 PhoneInput 均为普通权限。LOL 未运行，不能比较实际游戏进程的权限。
- 随后本机 LOL 客户端启动，实际读取到 `wegame.exe`、`LeagueClient.exe`、`LeagueClientUx.exe` 均为管理员权限，上号/PhoneInput 为普通权限。客户端权限差已确认，对局中的 `League of Legends.exe` 全屏行为仍未实测。
- LOL 兼容性注册表项只有 `HIGHDPIAWARE`，没有 `RUNASADMIN`；这不能排除被高权限启动器带起的情况。
- 正式版保存 `Backquote` / hold，开发版保存 `ArrowDown` / hold，并非同一配置。实际 LOL `Game/Config/input.ini` 的 `evtChampionOnly` 也绑定反引号，与正式版冲突。冲突不能单独证明后台监听失效；建议用 F10 做对照，不自动覆盖用户选键。
- 原有原生助手只给主键启用后台 Raw Input，组合键修饰键及鼠标侧键仍依赖 `GetAsyncKeyState`。微软说明该函数可能因 UIPI/输入桌面访问限制返回零，普通权限本身并不是失败证据。
- 桌面开发入口直接启动 tsup，绕过 package.json 的原生组件构建步骤，存在改了代码却仍用旧输入组件的风险。

## 本轮改动

- 键盘主键、左右修饰键、鼠标侧键均保留后台 Raw Input 路径；修饰键按扫描码/扩展位区分左右，释放一侧不会抹掉另一侧。
- 只保留所绑定主键与修饰状态，丢弃其他字符；不吞键、不向游戏注入输入、不接触音频或音频静音助手。
- 锁屏/安全桌面继续发健康状态，不把不可访问当成按键释放或输入助手崩溃。
- 每秒只读前台进程 TokenElevation 与自身比较，未知值保持未知。诊断导出增加 `inputDesktopAvailable` / `foregroundHigher`，权限变化写有界日志，不保存前台标题/正文。
- 桌面开发入口在启动前检查并按需构建原生组件，失败明确记录，避免悄悄沿用旧组件。
- 按用户“若权限不够就改管理员启动”的授权，在发现实际客户端权限差后，给本机桌面与开始菜单的“上号开发版”快捷方式设置管理员启动标记。原链接已备份，目标、参数、图标逐项一致；不修改发布 manifest 或其他用户默认权限。现有普通权限窗口没有强行关闭，需用户退出后重开并接受 UAC 才能切换权限。

## 验证与边界

- 原生 C# 状态测试 16 项：拒绝轮询零值覆盖已观察按下、左右 Ctrl/Shift/Alt、侧键释放、丢弃无关字母。
- 相关电话模式/快捷键测试 30 项通过；另启动器与监听状态测试 3 项通过。
- Windows 真正注册后台 Raw Input 成功，输入桌面与前台权限状态协议正常；测试未注入系统按键、未修改音频设备。
- 已编译更新开发版使用的原生助手并核验。更新时应用已关闭，未终止通话/录音，也未停止音频助手。
- 最新开发版已通过桌面入口打开，窗口响应正常，实际 Main 诊断确认 Raw Input ready。
- 最终全量测试以 `--test-concurrency=8` 运行：1480 通过、5 跳过、0 失败；类型、Lint 与差异检查通过。默认并发的两次整合各出现一项该录音队列夹具的限时失败，独立复测通过；原生 FFmpeg 夹具等待改为有界 15 秒，保留完成状态和数据断言，未改产品调度逻辑。
- 这不等于 LOL 全屏实测通过，也没有声称现有窗口已提权。没有更改游戏按键或游戏安全设置，未发布。

官方参考：[GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate)、[后台 Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input)。
