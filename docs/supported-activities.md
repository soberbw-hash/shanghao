# 支持的游戏与工作软件

本页与上号当前检测规则同步。游戏和工作状态只识别当前最前方窗口对应的受支持软件；“显示好友正在进行的工作”默认开启，可在设置中关闭。上号不读取文档内容、项目名或聊天内容。

游戏显示器优先使用当前电脑上已安装程序自带的官方高清图标，读取失败时才使用仓库中注明官方来源的本地图标。显示器只显示图标，游戏名称显示在角色状态中。上号只把压缩后的图标和下列固定名称同步给同房间好友，不发送文件路径。

## 游戏（49 项）

| 类别                    | 支持项                                                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 平台                    | KK 对战平台。只在 KK 实际启动了受支持的托管游戏进程时显示；单独打开或后台挂着 KK 平台不会显示为正在玩                                                                            |
| 腾讯及国内常用          | 英雄联盟、无畏契约、三角洲行动、穿越火线、地下城与勇士、暗区突围：无限、失控进化、逆战：未来、王者荣耀世界、异人之下、命运方舟、塔瑞斯世界、剑灵 2、洛克王国：世界、粒粒的小人国 |
| 网易 / 米哈游及国内热门 | 燕云十六声、鸣潮、绝区零、永劫无间、原神、崩坏：星穹铁道、黑神话：悟空、失落城堡 2                                                                                               |
| Blizzard / Valve / 射击 | 魔兽世界、炉石传说、CS2、Dota 2、Apex 英雄、绝地求生、守望先锋、Fortnite、彩虹六号：围攻、战地风云、终极角逐、逃离塔科夫                                                         |
| 单机 / 合作 / 其他      | 我的世界、王国保卫战、杀戮尖塔、极限竞速：地平线 5、赛博朋克 2077、巫师 3、GTA V、怪物猎人、艾尔登法环、双人成行、幻兽帕鲁、胡闹厨房、荒野大镖客 2                               |

腾讯 2026 新游范围参考 [腾讯 SPARK 2026 官方发布内容](https://www.tencent.com/zh-cn/articles/2202340.html)。KK 对战平台属于平台客户端：平台本体不算游戏；检测到由 KK 启动且位于前台的实际游戏进程时统一显示“KK 对战平台”，不猜测具体地图或模式。

## 工作软件（62 项）

| 类别                | 支持项                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 编程与开发          | Codex、WorkBuddy、Visual Studio Code、Cursor、Trae、Visual Studio、IntelliJ IDEA、PyCharm、WebStorm、CLion、Rider、GoLand、Android Studio、GitHub Desktop、Postman、Docker Desktop、Python、Java、Eclipse、NetBeans、Unity、Unreal Editor |
| Adobe / 设计 / 影音 | Photoshop、Illustrator、Figma、InDesign、Premiere Pro、After Effects、Adobe Audition、Media Encoder、DaVinci Resolve、Blender、Maya、3ds Max                                                                                              |
| 工程与电子          | AutoCAD、SOLIDWORKS、Revit、Fusion 360、CATIA、Siemens NX、LabVIEW、ANSYS、Altium Designer、Proteus、Keil、STM32CubeIDE、Arduino IDE、SketchUp                                                                                            |
| 数据与办公          | MATLAB、RStudio、Anaconda Navigator、Power BI、Tableau、Origin、SPSS Statistics、Word、Excel、PowerPoint、Visio、WPS Office、Notion、Obsidian                                                                                             |

## 识别说明

- 游戏按明确的进程名匹配；具体游戏优先于平台客户端，普通 Java 程序不会被当成游戏。
- 工作软件优先显示当前获得 Windows 前台焦点的应用；回到上号后，会继续显示一个仍在打开且有主窗口的支持软件。
- Spotify、Apple Music、网易云音乐和 QQ 音乐属于音乐状态，不受工作状态开关影响。
- 软件升级不会清除本地聊天历史、录音目录或每位好友的本地音量设置。
