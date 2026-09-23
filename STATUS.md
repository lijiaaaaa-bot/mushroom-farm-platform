# STATUS｜mushroom-farm-platform

更新：2026-09-23 22:45（Asia/Shanghai）
仓：https://github.com/lijiaaaaa-bot/mushroom-farm-platform

进度只认：已合并 PR + 已关闭 Issue + 本文件一行。聊天文字不算交付。

## 已完成
- harness 已抽出为 project-harness-day0（https://github.com/lijiaaaaa-bot/project-harness-day0）
- Day-1 硬墙 + HTTP 接入 + 告警确认（smoke）
- 公开 GitHub main；`bid-sample/`、`docs/` 在仓内
- #7 squash 合入 main、#6 已关闭：接入墙与 CI 门禁在 main
- #5 squash 合入 main（4dd50a1）、#1 已关闭：MQTT recognition 与 HTTP 同管道
- CI job `ingest-smoke` 跑 `make smoke`：`scripts/edge-simulator.mjs` 向 Mosquitto / HTTP 发送契约黄金报文，证据目录 `evidence/ingest-last-run/` 上传为 artifact `ingest-smoke-evidence`；可打开的一次真实跑样在 `evidence/ingest-sample/summary.json`
- #2 `/big-screen` 五区页（顶 / 左 / 中 / 右 / 底）接现有总览、棚区、告警、设备、识别列表 API；路由与页面实体测试见 https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/10
- #3 admin devices/alerts/harvest/reports wired to existing API + vitest + Family B Light; PR #19; Issue closed.
- #4 console PR #1 merged（https://github.com/lijiaaaaa-bot/mushroom-project-console/pull/1 ，squash f75deeb）；`public/status.json` matches Issues/PR/STATUS；Issue #4 closed.
- #23 `/alert-rules` writable for admins; PR #24 merged; Issue closed.
- #26 `/diseases` 列出 diseaseCount>0 的识别，识别页与病害页可打开已存抓拍；PR #29 squash 合入 main（ca8ef58）；Issue closed.
- #30 `/devices` 摄像头批量导入；PR #31 squash 合入 main（746e224）；Issue closed.
- #32 站内告警未读入口；PR #33 squash 合入 main（5d104b2）；Issue closed.
- #27 棚区平面坐标（F-R2-03 / F-R8-03）：`sheds.map_x` / `map_y`、管理端可编辑、大屏点位读取配置坐标；PR #28 squash 合入 main（dfbdbd0）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/28
- #34 环境报文接入与管理端观测：`POST /api/v1/ingest/environment` 与 MQTT `mushroom/+/+/environment` 写入 `environment_readings`；`/environment` 展示最近读数。PR #35 squash 合入 main（0c4f329）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/35
- #36 `/harvest` 当日清单可修正成熟数与蘑菇数，写入审计（谁、何时、旧值→新值、棚/摄像头）；汇总随修正更新；棚隔离；查看员只读。PR #37 squash 合入 main（418dee1）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/37
- #38 F-R8-02 设备心跳与离线告警：HTTP `POST /api/v1/ingest/heartbeat` 与 MQTT `mushroom/+/+/heartbeat` 写入 lastHeartbeatAt，超时产生设备离线告警，恢复心跳自动关闭。PR #40 squash 合入 main（d23fc66）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/40
- #41 F-R1-07 接入可观测：`GET /api/v1/ingest/observability` 汇总近窗接收、拒收、延迟与最近错误；覆盖识别 HTTP/MQTT、环境与心跳。`/ingest-observability` 展示数字与最近错误，加载失败不渲染空表。PR #42 squash 合入 main（4d04654）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/42
- #43 F-R3-04 告警认领与误报关闭：`POST /api/v1/alerts/:id/claim` 写入认领人；`POST /api/v1/alerts/:id/false-positive` 以 closeReason `false_positive` 关闭，与普通关闭的 `resolved` 区分；认领、误报、关闭写入审计。`/alerts` 有认领与误报入口，查看员只读。PR #44 squash 合入 main（6690bcb）；Issue closed. https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/44
- #48 管理端总览在 `/dashboard/overview` 有序列时用 ECharts 画成熟、总数、病害，并列出未关闭告警与最近识别；识别页与病害页为抓拍图卡。侧栏 `#1B7A4E`，页面底 `#F5F7FA`，白卡片 8px 圆角、1px `#E5E6EB`。PR #51。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/51
- #57 侧栏「基地大屏」紧跟总览并链到 `/big-screen`，去掉「二期槽位」；企微不进侧栏。PR #57 squash 合入 main（199bc05）。
- #54 F-R3-06 严重告警推送企微/钉钉：`WECOM_WEBHOOK_URL` 与/或 `DINGTALK_WEBHOOK_URL`（可选 `DINGTALK_WEBHOOK_SECRET`）。未配置则不发送、不报错。推送失败只记日志。告警页进入 `/phase2/wecom`。PR #58 squash 合入 main（e948335）；Issue #54 已关闭。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/58
- #60 管理端总览改为 ThingsBoard 浅色运营台：指标条、已配置坐标的棚区平面、棚区表、温度图（阈值来自已启用规则）、近 7 日成熟/总数/病害、右侧告警表。侧栏沿用 #57。PR #60 squash 合入 main（af813be）。
- `GET /api/v1/alerts/unread`：`alert_reads.alert_id` 与 `alerts.id` 同为 uuid。已有库由 `007_alert_reads_alert_id_uuid.sql` 丢掉空值和非 uuid 行后 `ALTER ... USING btrim(alert_id)::uuid`。未读计数不再因 `character varying = uuid` 返回 500。PR #61。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/61

## 进行中
- 管理端总览改为浅色顶栏加 188px 白导航；棚区平面用床位底图和状态色块，芯片显示温度、湿度、在线；温度图虚线只来自已启用的温度规则。`/big-screen` 夜色仍只在该页根节点，抓拍卡与面板收紧。
- #55 F-R2-04 基地大屏：管理端侧栏与顶栏进入 `/big-screen`。默认一屏为指标、棚区平面、抓拍墙、告警与环境；可切抓拍墙或带时间轴的多区。时间轴跳到 `/growth-trends` 或识别记录的上海日筛选。夜色投屏皮肤 `data-skin=tb-night` 只在这一页。PR #59 已 rebase 到含 #60 的 main，未合，不关 Issue。
- #48 管理端 Family B 轻量农事风落地（对照调查 04/06 样张；云端改代码中）
- #47 F-R4-01 / F-R4-02 生长趋势日聚合：`daily_aggregates` 按棚与摄像头保存当日最新蘑菇数和菌盖直径均值；识别入库后刷新，每小时回写昨日与当日；`GET /api/v1/growth-trends?days=7|30` 按棚隔离；`/growth-trends` 只画已有日点。PR #52 未合，不关 Issue。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/52
- #49 F-R6-03 近 2–3 日产量估计：`GET /api/v1/harvest/yield-estimate` 用近 30 个上海自然日、各摄像头当日最新成熟数之和做线性外推，响应与 `/harvest` 标注「估计」。不满 30 天只返回说明、`days` 为空。棚隔离；棚外 `shedCode` 403。PR #53 未合，不关 Issue。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/53
- #50 F-R5-02 病害与同期环境同屏：`GET /api/v1/diseases/:id/environment` 按识别棚对齐识别时间前后各 30 分钟的温度、湿度、CO₂、基质含水率，可选传感器再收窄；无读数返回「该时间窗内无环境读数」，不用识别报文里的环境字段充数。`/diseases` 选中一条同屏展示。棚外 403。PR #53 未合，不关 Issue。https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/53

## 待开
- 无（全量需求切片已开）

## 规范
- Overnight 工单：协议在 harness `docs/OVERNIGHT.md`；本仓指针 `docs/OVERNIGHT_TICKET.md` 与 Issue 表单。PR：#18
- 识别与环境补传窗口为 90 天（`LIMITS.recognizedAtPastDays`），与时序明细在线保留一致。

## 阻塞
- 无
