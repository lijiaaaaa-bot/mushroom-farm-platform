# STATUS｜mushroom-farm-platform

更新：2026-09-23 21:05（Asia/Shanghai）  
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

## 进行中
- #48 管理端 Family B 轻量农事风落地（对照调查 04/06 样张；云端改代码中）
- #47 生长趋势日聚合曲线 F-R4-01/02（云端改代码中）
- #49 产量预估近 2–3 日 F-R6-03（云端改代码中）
- #50 病害与同期环境同屏对照 F-R5-02（云端改代码中）

## 待开
- 无（全量需求切片已开；企微/钉钉 F-R3-06、精装大屏 F-R2-04 下一波）

## 规范
- Overnight 工单：协议在 harness `docs/OVERNIGHT.md`；本仓指针 `docs/OVERNIGHT_TICKET.md` 与 Issue 表单。PR：#18

## 阻塞
- 无
