# Windows 网络权限与启动修复

上号 2.4 的正式 Windows 安装包会请求管理员权限，用于创建只属于上号的应用级防火墙
规则。开发模式不会提权，也不会修改防火墙。

## 设置页检查

打开“设置 → 诊断”，Windows 网络权限区域会显示：

- 当前进程是否已提升权限。
- `ShangHao Network` 组是否存在四条健康规则。
- 当前用户的 `ShangHao Auto Start` 计划任务是否指向当前 EXE。

点击“修复网络权限”只会重建以下四条规则：

- ShangHao UDP Inbound
- ShangHao UDP Outbound
- ShangHao TCP Inbound
- ShangHao TCP Outbound

规则限定当前 `ShangHao.exe`，应用于全部 Windows 网络配置文件；入站规则允许边缘穿越。
不会扫描、关闭或删除用户现有的其他防火墙规则。

## 手工核对

在管理员 PowerShell 中运行：

```powershell
Get-NetFirewallRule -Group "ShangHao Network" |
  Select-Object DisplayName, Enabled, Direction, Profile

Get-ScheduledTask -TaskName "ShangHao Auto Start" |
  Select-Object TaskName, State, @{Name="RunLevel";Expression={$_.Principal.RunLevel}}
```

正常结果是四条已启用规则，以及在用户主动打开“开机启动”后出现一个
`HighestAvailable`、交互式登录、延迟 5 秒的计划任务。

## 更新与卸载

覆盖安装后应用会按新 EXE 路径修复开机任务和防火墙规则。卸载器只移除
`ShangHao Auto Start` 和 `ShangHao Network`，不影响其他软件。诊断包会附带
`windows-integration.json`，其中不包含密码、Token 或音频内容。
