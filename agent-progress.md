# Agent progress（外置会话记忆）

> 写在窗外，按条追加；禁止整份重写成空话摘要。

## 当前
- 本会话目标：#45 STATUS 看板对齐。#41 已完成（PR #42）；#43 已完成（PR #44）；进行中无已关闭 Issue
- 进行中文件：`STATUS.md`

## 日志
| 日期 | 做了什么 | 如何验收 | 未决 |
|------|----------|----------|------|
| 2026-09-23 | 接入 gates + 上下文文档 | PR #11/#12、make gates | 大屏 Issue #2、文档口径 PR #9 |
| 2026-09-23 | 行为探针：会话协议开场检查 | 本 PR + make gates | 无 |
| 2026-09-23 | 边缘模拟实体发送契约黄金报文；make smoke 写 evidence/ingest-last-run；CI job ingest-smoke 上传 artifact | 本地 make smoke 已通过；样本 evidence/ingest-sample/summary.json（2026-09-23T07:07:14.170Z） | CI artifact 需看 Actions |
| 2026-09-23 | `/big-screen` 五区页 rebase 到 main，并加路由与页面实体测试 | `npm --prefix apps/web test`；`make test`；PR #10 | Issue #2 随 PR #10 合并后关闭 |
| 2026-09-23 | STATUS 与 PR #10 只记路由、五区、现有 API 接线与实体测试 | `make gates`；PR #10 正文 | 视觉方向不写入本 PR 验收 |
| 2026-09-23 | `/big-screen` 分区改为浅底 #F5F7FA、白卡片、强调色 #1B7A4E/#2F9E44、圆角 8px | `npm --prefix apps/web test` | STATUS 不写视觉口号 |
| 2026-09-23 | Overnight 工单模板：谓词 / 隔离 / decisions.tsv / 逃生口；Issue Form | `make gates`；`docs/OVERNIGHT_TICKET.md` | PR #18 未合并 |
| 2026-09-23 | Overnight 正文改到 harness；本仓 `docs/OVERNIGHT_TICKET.md` 只留指针。Issue 表单仍在 | `make gates`；PR #18 | 不在本仓维护第二份协议 |
| 2026-09-23 | #3 四页已有 API 调用；补告警失败不显示空态、采摘失败清空旧数据、报表空 Blob 空态、管理端浅色令牌、路由与页面 vitest | `npm --prefix apps/web test` 20 passed；`make gates` 通过 | PR #19 未合，不关 Issue #3 |
| 2026-09-23 | #19/#3 done：PR #19 squash 合入 main（506427d），Issue #3 已关闭；STATUS 已完成一行 | `gh pr view 19` MERGED；`gh issue view 3` CLOSED | 无 |
| 2026-09-23 | STATUS：#4 从待开移到进行中；console overnight agent 对齐 mushroom-project-console `public/status.json` | `make gates`；本 PR | 指挥台仓尚无 PR 号，不关 Issue #4 |
| 2026-09-23 | STATUS：#4 移入已完成。console PR #1 squash 合入 main（f75deeb）；`public/status.json` 与 Issues/PR/STATUS 一致；Issue #4 已关闭 | `make gates`；本 PR | 无 |
| 2026-09-23 | #23 阈值规则页接到已有 POST/PATCH `/alert-rules`。不改 AlertsController / AlertEngine。写权限仅超管与生产管理员 | `make test` 与 `make gates` 退出码 0；PR #24 | PR #24 未合，不关 Issue #23 |
| 2026-09-23 | STATUS：#23 移入已完成。PR #24 squash 合入 main（c560613）；`/alert-rules` 管理员可写；Issue #23 已关闭 | `make gates`；`gh pr view 24` MERGED；`gh issue view 23` CLOSED | 无 |
| 2026-09-23 | #30 摄像头批量导入：POST /devices/import 接受 CSV 文件、CSV 文本或 JSON 行。设备编码冲突跳过且不改原档案。棚不存在或无权只失败该行。超管、生产管理员、棚负责人可导入；查看员 403 | `make test` 与 `make gates` 退出码 0（API jest 28，web vitest 36） | PR #31 未合，不关 Issue #30 |
| 2026-09-23 | #26 病害页与抓拍打开：GET /diseases 过滤 diseaseCount>0；GET /ingest/recognitions/:id/snapshot 读 MinIO 或原图 URL；棚隔离仍走 ShedScope | `make test` 与 `make gates` 退出码 0（API 19，web vitest 31）；不关 Issue #26 | PR #29 未合 |
| 2026-09-23 | #32 站内未读：GET /alerts/unread、POST /alerts/:id/read、POST /alerts/read-all。已读按用户记在 alert_reads，不改告警状态。顶栏 15 秒轮询。浏览器通知仅在授权后；拒绝不抛错 | `make test` 与 `make gates` 退出码 0 | PR #33 未合，不关 Issue #32 |
| 2026-09-23 | #32 验收：API jest 30（alert-unread：创建后范围内计数上升、单条/全部已读、棚外 403）；web vitest 42（列表字段、计数下降、失败非空表、轮询、拒绝通知不抛错） | `make test` && `make gates` 退出码 0 | 本机无 Docker，未跑登录后的浏览器；PR #33 未合 |
| 2026-09-23 | #27 棚区平面坐标：迁移 `map_x`/`map_y`，超管与生产管理员 PATCH，棚负责人与查看员只读且仍按棚隔离；大屏有坐标用配置、缺一轴则回退网格 | `make test` 与 `make gates` 退出码 0；浏览器保存 32/48 后大屏摘要仍在；PR #28 | 不自动合并，不关 Issue #27 |
| 2026-09-23 | #27 CI：平面坐标输入改为保存输入框文本，点击「保存坐标」发出 PATCH。分支 rebase 到含 #29/#31/#33 的 main | `make test` 与 `make gates` 退出码 0（jest 35，vitest 45） | PR #28 仍不合并 |
| 2026-09-23 | #34 环境报文：HTTP POST /ingest/environment 与 MQTT mushroom/+/+/environment 写入 environment_readings。幂等键优先，否则按棚、传感器、观测时间哈希；Redis 与唯一约束双保险。/environment 列出最近读数，失败不显示空表。棚隔离沿用 ShedScope | 待 `make test` 与 `make gates` | PR 未合，不关 Issue #34 |
| 2026-09-23 | #34 验收：合法上报、显式键与缺省键重复、Redis 不可用时的唯一约束、识别报文打到环境路径被拒、棚负责人与查看越权 403、MQTT 入库不进识别管道。页面失败非空表、有数据渲染 | `make test` 退出码 0（API jest 39，web vitest 45）；`make gates` 退出码 0 | PR #35 未合，不关 Issue #34。本机无 Docker，未打开登录后页面 |
| 2026-09-23 | #34 rebase 到 main dfbdbd0。STATUS：#27 移入已完成（PR #28 squash dfbdbd0，Issue closed）；#34 仍进行中，链接 PR #35 | `make test` 退出码 0（API jest 44，web vitest 48）；`make gates` 退出码 0 | PR #35 不合并 |
| 2026-09-23 | #36 采摘修正：PATCH /harvest/daily/:id 改成熟数与蘑菇数并写回 recognition_records。审计 harvest.correct 带棚、摄像头、旧值→新值。超管、生产管理员、棚负责人可改；查看员 403 且页面无保存。棚负责人不能改他棚。保存后重拉当日汇总 | 待 `make test` 与 `make gates` | PR 未合，不关 Issue #36 |
| 2026-09-23 | #36 验收：合法修正后汇总变为成熟 0、蘑菇 6、可采摄像头 0；越权棚 403 且不写审计；查看员 403；审计一行含用户、时间、棚、摄像头、旧值→新值。页面保存后刷新，失败仍留表，查看员无保存 | `make test` 退出码 0（API jest 50，web vitest 54）；`make gates` 退出码 0 | 本机无 Docker，未打开登录后的 /harvest |
| 2026-09-23 | PR #37 由 lijiaaaaa-bot 合并（squash 418dee1），Issue #36 关闭。本代理未执行合并。STATUS 将 #36 移入已完成 | `make gates` | 进行中无下一条 |
| 2026-09-23 | #38 心跳：POST /ingest/heartbeat 与 MQTT 共用 parseHeartbeatIngress。lastHeartbeatAt 决定在线；超时开「设备离线」，恢复心跳自动关闭。棚负责人与查看员沿用 ShedScope | 见 decisions.tsv；make test / make gates 待本轮验收 | PR 未合，不关 Issue #38 |
| 2026-09-23 | #38 验收：心跳更新 lastHeartbeatAt、相同 reportedAt 为 duplicate、超时一条设备离线告警、恢复心跳自动关闭、列表含在线状态、棚负责人不见他棚、失败不渲染空表 | `make test` 退出码 0（API jest 57，web vitest 56）；`make gates` 退出码 0 | 本机无 Docker，未打开登录后的 /devices。PR #40 未合，不关 Issue #38 |
| 2026-09-23 | #41 接入观测：GET /ingest/observability 汇总近窗接收、拒收、p50 与最近延迟、最近错误。识别与环境按入库行计，心跳含重复上报。/ingest-observability 展示数字与错误；失败不渲染表。棚负责人不见他棚和无棚号拒收 | `make test` 退出码 0（API jest 59，web vitest 59）；`make gates` 退出码 0 | 未打开登录后的 /ingest-observability。PR #42 未合，不关 Issue #41 |
| 2026-09-23 | #43 认领与误报关闭：POST /alerts/:id/claim 写入 claimedBy；POST /alerts/:id/false-positive 以 closeReason=false_positive 关闭，普通关闭为 resolved。备注进审计。查看员与棚外 403。`/alerts` 沿用浅色 panel / btn-ghost | `make test` 退出码 0（API jest 63，web vitest 63）；`make gates` 退出码 0 | 本机无 Docker，未打开登录后的 /alerts。PR #44 未合，不关 Issue #43 |
| 2026-09-23 | #45 STATUS：#41 已在已完成并引用 PR #42（squash 4d04654，Issue closed）；#43 从进行中移入已完成（PR #44 squash 6690bcb，Issue closed）；进行中改为无 | `gh pr view 42` MERGED；`gh pr view 44` MERGED；`gh issue view 41` CLOSED；`gh issue view 43` CLOSED；`make gates` | 不改业务代码，不自动合并 |
