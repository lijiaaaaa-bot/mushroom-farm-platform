# Agent progress（外置会话记忆）

> 写在窗外，按条追加；禁止整份重写成空话摘要。

## 当前
- 本会话目标：指标预聚合需求入仓，开切片 B–E，实现切片 B 小时桶与识别增量 upsert
- 进行中文件：`docs/metrics-preaggregation-requirements.md`、`apps/api/src/growth/growth-trend.service.ts`、`apps/api/src/ingest/ingest.service.ts`

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
| 2026-09-23 | #48 草稿：STATUS 进行中。目标是总览有数据时画曲线并列出告警/识别，识别与病害改为图卡；侧栏与色板按 Family B 浅色农事 | 草稿 PR 先开，页面改动随后推 | 不关 Issue |
| 2026-09-23 | #48 管理端：绿侧栏 `#1B7A4E`、页面 `#F5F7FA`、白卡片 8px / `#E5E6EB`。总览 8 个 KPI；trend 非空才 init ECharts（成熟/总数/病害），空趋势不留高空白图。告警表与最近识别列表同页。识别与病害改为 result-card 图卡。设备/告警/采摘/环境/接入观测带 ops-page | `make test` 退出码 0（API jest 63，web vitest 69）；`make gates` 退出码 0 | 未打开登录后的总览。PR #51 草稿，不关 Issue |
| 2026-09-23 | #50 病害同期环境：GET /diseases/:id/environment 按棚（可选传感器）对齐识别时间前后各 30 分钟。空窗说明，不用识别自带温湿度充数。/diseases 同屏。#49 产量：GET /harvest/yield-estimate，满 30 个上海自然日才线性外推未来 3 日并标注「估计」，不足则说明且 days 为空。棚隔离 | 待 `make test` 与 `make gates` | PR 未合，不关 Issue #50 / #49 |
| 2026-09-23 | #50/#49 验收：环境窗含前后边界与他棚排除，空态不显示识别自带 22.5；产量平坦序列外推 15/1015，缺日 days 为空，棚负责人请求他棚 403。页面同屏与「估计」标注。jsdom 不初始化 ECharts | `make test` 退出码 0（API jest 72，web vitest 68）；`make gates` 退出码 0 | 未打开登录后的 /diseases 与 /harvest。PR #53 草稿未合，不关 Issue |
| 2026-09-23 | #47 生长趋势日聚合：daily_aggregates 存棚/摄像头当日最新蘑菇数与菌盖直径均值；识别入库与蘑菇数修正后刷新，每小时回写昨日和当日；GET /growth-trends 仅 7/30 天且按棚隔离；/growth-trends 只画已有日点 | `make test` 退出码 0（API jest 72，web vitest 65）；`make gates` 退出码 0 | 未打开登录后的 /growth-trends。PR #52 未合，不关 Issue #47 |
| 2026-09-23 | 管理端总览改成 ThingsBoard 浅色运营台：指标条、已配置坐标的棚区平面、棚区表、温度曲线（阈值只画已启用的温度规则）、近 7 日成熟/总数/病害、右侧告警表、最近识别表。/big-screen 加 data-skin=tb-night | `make test` 退出码 0（API jest 85，web vitest 81）；`make gates` 退出码 0 | 未打开登录后的总览。侧栏导航以 #57 为准 |
| 2026-09-23 | PR #60 rebase 到含 #56/#57/#58 的 main。侧栏保留「基地大屏」徽标与绿色底，不恢复「二期槽位」，不把企微放回导航。总览仍是浅色运营台 | 待 `make test` 与 `make gates` | 不关未合并 Issue |
| 2026-09-23 | 识别与环境补传窗口改为 90 天（`LIMITS.recognizedAtPastDays` = `TIMESERIES_RETENTION_DAYS`）。满 90 天整点仍收，超出 1ms 拒收并返回补传窗口错误。8 天前的报文可通过解析 | `make test` 退出码 0（contracts 8，API jest 85，web vitest 80）；`make gates` 退出码 0 | 不改幂等 TTL，不改大屏/报表的 7 日查询窗。PR #56 |
| 2026-09-23 | #54 严重告警推送：WECOM_WEBHOOK_URL 与/或 DINGTALK_WEBHOOK_URL，可选 DINGTALK_WEBHOOK_SECRET。未配置不发送、不报错。webhook 失败只记日志。认领与关闭仍成功。/phase2/wecom 说明变量并显示通道是否启用 | `make test` 退出码 0（API jest 95，web vitest 82）；`make gates` 退出码 0 | 本机无 Docker，未打开登录后的 /phase2/wecom。PR #58 未合，不关 Issue #54 |
| 2026-09-23 | #54 rebase 到 main（含 #56/#57）。侧栏不放企微入口、不写「二期槽位」。告警页「企微/钉钉推送」链到 `/phase2/wecom` | `make test` 退出码 0（API jest 95，web vitest 82）；`make gates` 退出码 0 | PR #58 待标为可审。不关 Issue #54 |
| 2026-09-23 | #55 `/big-screen` 增加抓拍墙、多区布局和对比时间轴。时间轴链到 `/growth-trends` 与识别记录的 from/to。暗色只挂在大屏根节点，默认浅色 | `make test` 退出码 0（API jest 85，web vitest 89）；`make gates` 退出码 0 | 未打开登录后的 /big-screen。PR #59 未合，不关 Issue #55 |
| 2026-09-23 | #55 管理端侧栏卡片和顶栏按钮进入基地大屏，去掉占位入口。默认一屏以抓拍墙为中部，平面与告警收在两侧。暗色只加在大屏根节点 | `make test` 退出码 0（API jest 85，web vitest 90）；`make gates` 退出码 0 | 未打开登录后的页面。PR #59 未合，不关 Issue #55 |
| 2026-09-23 | #55 rebase 到含 #60 的 main。总览浅色运营台不动。`/big-screen` 保留抓拍墙、多区与时间轴，根节点 `data-skin=tb-night` | `make test` 退出码 0（API jest 95，web vitest 93）；`make gates` 退出码 0 | 未打开登录后的页面。PR #59 标为可审，未合，不关 Issue #55 |
| 2026-09-23 | `GET /api/v1/alerts/unread`：`alert_reads.alert_id` 与 `alerts.id` 同为 uuid。`002` 新库直接建 uuid；`007` 对已有 varchar 列先丢空值和非 uuid，再 `ALTER ... USING btrim(alert_id)::uuid`。未读列表与 unreadCount 在 API jest 中覆盖 varchar=uuid。`.local-sim/live-feeder.mjs` 不在 main 与历史提交，不另加演示脚本 | `make test` 退出码 0（API jest 98，web vitest 93）；`make gates` 退出码 0。PGlite 跑过旧 varchar 与新 uuid 的未读 COUNT | PR #61。不关其他 Issue |
| 2026-09-23 | 总览去掉 8 格指标条和深绿侧栏。顶栏放名称，左侧 188px 白导航，基地大屏仍在总览后。平面用床位底图和状态色块，芯片写温度、湿度、在线；缺坐标的棚落在底边并写未标坐标。温度图虚线只画已启用的温度过高/过低规则。近 7 日为面积图。大屏夜色仍只在 `.screen[data-skin=tb-night]`，抓拍空态是虚线框「无抓拍」。分支已 rebase 到含 #61 的 main，未改 `007` 与 alert_reads uuid | `make test` 退出码 0（API jest 98，web vitest 93）；`make gates` 退出码 0。本机无 Docker，用本地 mock 打开总览、悬停芯片、窄屏菜单、设备页、大屏指挥/抓拍墙/多区 | 下一人：对照 ThingsBoard 浅色总览和夜色大屏看总览平面与抓拍墙。不改接入接口 |
| 2026-09-24 | #63：白导航去掉实心绿标和角标口号；总览标题只留短名，平面改为状态色钉，告警程度用红/琥珀胶囊，在线深绿字、离线灰字，温度阈值线加粗。大屏抓拍空态为细框「无图」，`snapshotUrl` 的 http/data 与对象存储 JPEG 直接出图，媒体区不再铺实心品牌绿 | web vitest 93、vue-tsc、web eslint、API jest 98、API eslint、`make gates` 均通过。Chrome 1440 总览与 1600 大屏：品牌绿像素低于 0.2%，侧栏左侧 200px 为 0 | 不关 Issue #63。未跑 `make test` 里的 contracts node 与边界脚本 |
| 2026-09-24 | 监控样张入库 `docs/evidence/monitor-batch`（8 张 JPEG，`cam-s03-01` 含绿霉）。STATUS：#63/#64、#55/#59、#47/#52、#49+#50/#53 从进行中移入已完成；#48/#51 与 #54/#58 已在已完成，去掉进行中重复行。进行中改为无 | `gh pr view` 均为 MERGED，对应 Issue 均为 CLOSED；`make gates` | 不改应用代码。本地演示规模可少于需求规格约 30 棚、110 路 |
| 2026-09-24 | 指标预聚合需求入仓；Issue #66 切片 B、#67 C、#68 D、#69 E。切片 B：`metric_buckets_hour` / `metric_buckets_day`，识别 ingest 按 `recognizedAt` 增量 upsert，重复幂等键不双计，补传改历史桶。小时 cron 与采摘修正仍走 `refreshDay` 重算昨/当日并回写桶 | `make test` 退出码 0（contracts 9，API jest 100，web vitest 93）；`make gates` 退出码 0。PR #70 | 趋势/大屏仍读 `daily_aggregates`（#67）。环境与高发统计未入桶（#68）。不安装 Timescale（#69）。不关 #66，等 PR 合并 |
