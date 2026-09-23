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
- #2 `/big-screen` 五区清亮农作物监测页（顶 / 左 / 中 / 右 / 底）接现有 API：https://github.com/lijiaaaaa-bot/mushroom-farm-platform/pull/10

## 视觉口径（与 Issue #2 一致）
- 看板与指挥大屏：清亮农作物监控风格（农业场景）。暗色可选，不是验收硬约束。不以公安 / 雪亮类比作为验收。

## 进行中
- 无

## 待开
- #3 管理端四页（设备 / 告警 / 采摘 / 报表接通 API），排在 #2 之后
- #4 指挥台 `status.json` 对齐（仓：https://github.com/lijiaaaaa-bot/mushroom-project-console）

## 阻塞
- 无
