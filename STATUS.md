# STATUS｜mushroom-farm-platform

更新：2026-09-23（Asia/Shanghai）  
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

## 进行中
- #26 `/diseases` 列出 diseaseCount>0 的识别（时间、棚、摄像头、等级、数量），识别页与病害页可打开已存抓拍；棚隔离沿用 ShedScope。PR 未合，不关 Issue
- #30 `/devices` 摄像头批量导入（CSV 文件或粘贴）；设备编码冲突跳过；棚不存在或无权按行失败。PR #31 未合，不关 Issue

## 规范
- Overnight 工单：协议在 harness `docs/OVERNIGHT.md`；本仓指针 `docs/OVERNIGHT_TICKET.md` 与 Issue 表单。PR：#18

## 待开
- 无

## 阻塞
- 无
