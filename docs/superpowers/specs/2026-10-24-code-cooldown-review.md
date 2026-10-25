# 临时码防猜测审核问题修复与复核材料

已证实 P2：旧实现固定地址分钟额度，连续失败不递增、跨来源缺少设备累计。主任务已核对实际 Runtime/Broker 路径，意见成立。

## 实现

- 新 `packages/signaling/src/temporary-code-attempts.ts` 在设备签名验证后，以独立设备及网络键维护有界失败记录。默认设备第 5 次、网络第 20 次失败起，冷却 2 秒并逐次翻倍，上限 5 分钟；30 分钟无失败过期，最多 8192 条维度记录。墙钟回退不缩短冷却。
- Runtime resolve/join 与同一 server 的公网 lookup 共用实例；改变来源不清设备历史，改变设备不清网络历史。真正查到房间只清该设备连续失败，不清同网失败累计。
- 已登记但临时离线/注册过期的非 terminal 房间码为中性结果：保持公开响应 null，不计猜错，也不清已有失败。中性判断仍在既有设备/网络冷却检查之后，不能绕过限流。
- 冷却/容量在操作前检查，防止入房已修改状态才报限流。被阻止的重试不延长冷却、不分配新设备记录。只统计错误/无效房间码，满员/锁定和其他错误不加失败。resume/recover/heartbeat 不经过猜码守卫。
- 现有未认证地址分钟额度、挑战数量/有效期限制保留。伪造签名不能为目标设备添加失败。Runtime/Broker 认证时钟与各自注入时钟统一，生产默认仍 Date.now。
- 服务端可通过 `SHANGHAO_TEMP_CODE_` 加 `DEVICE_FAILURES`、`NETWORK_FAILURES`、`BASE_DELAY_MS`、`MAX_DELAY_MS`、`RETENTION_MS`、`MAX_ENTRIES` 配置；只接受有界整数及合理组合，renderer/房间请求不能更改。
- 限流提示为“尝试太频繁，请稍后再试”。不输出正文或凭据，无文件持久化和账号改动。

## 证据

新增 `apps/desktop/tests/temporary-code-attempts.test.ts` 使用实际 Runtime/Broker 协议、真实 Ed25519 proof、合成 socket/clock（无网络和真实文件）。覆盖跨分钟/换网络/多设备共网/resolve+join+lookup共用/伪造proof/正常resume/容量与TTL/时钟回退/配置校验。

新守卫不存在时先运行失败，实现后专项 8/8；离线正确码补两项后 10/10。其他临时准入、公网 TLS、永久房间和架构定向 34/34，日志 `artifacts/temporary-code-cooldown-tests.log`。最新结果：

- 专项 10 项加实际 WSS/进程故障 6 项，联合 16/16；`artifacts/code-cooldown-recovery-tests.log`。
- 全量 smoke 1408 总项、1403 通过、5 跳过、0 失败，99.5 秒；`artifacts/continuation-smoke.log`。
- 随后新增一次连续 8 个房间、每房间 3 个独立进程的公网加入压力回归，强制私密复制经过内层 TLS，1/1 通过；`artifacts/code-cooldown-entry-stress.log`。因此该新用例不包含在前述 1408 总数内，不冒称重跑了更新后的全量。
- desktop/signaling 类型检查、desktop 全量及本次 signaling 文件 ESLint、格式通过；最后仅增加测试后再跑该文件 lint/desktop 类型检查通过。Main/preload、signaling ESM/CJS/类型构建通过；`artifacts/code-cooldown-*-build.log`。
- 五人音频与媒体通过；`artifacts/code-cooldown-five-peer-audio.log`、`artifacts/code-cooldown-five-peer-media.log`。

初次整合暴露两个真实边界：离线正确码曾被计错；目录即时重启可能合法保留旧 epoch，且本地恢复早于公网发布。已补前者的生产修复；后者夹具改为跨过租约失效后重启，并在现有 10 秒发布失败退避及 5 秒刷新窗口内有界等待，保持同 Session、epoch 2、查码和新成员加入断言。

另有一次整合出现公网主持故障用例在初始加入阶段报 `temporary_connection_failed`，专项和最终整合未复现。新增每步错误上下文和上述连续加入回归，但尚未定位该偶发现象根因，不能写成已证明修复或永久消失。该记录作为后续稳定性观察项保留。

“上号审核”先独立复核 8/8 并明确关闭原 P2，再独立检查三态增量、重跑 10/10 并给出通过结论。原整轮 126 项独立测试及真实设备未验边界不变。

## 保留边界

记录只在当前服务进程内；重启或 LAN 更换主持不复制猜码历史。设备 ID 代表经签名证明的安装身份，重新生成身份仍由网络维度约束，不宣称阻止所有分布式攻击。短码准入保护不能替代远程控制独立批准。

本次未发布/部署/打包/改版本/重启用户窗口。真实双机、NAT/TURN、耳机、live 远控及耐久按原清单待实机验收。
