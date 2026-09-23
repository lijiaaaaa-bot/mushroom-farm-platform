# STATUS｜mushroom-farm-platform

更新：2026-09-23（Asia/Shanghai）  
仓：https://github.com/lijiaaaaa-bot/mushroom-farm-platform

进度只认：已合并 PR + 已关闭 Issue + 本文件一行。聊天文字不算交付。

## 已完成
- Day-1 硬墙 + HTTP 接入 + 告警确认（smoke）
- 公开 GitHub main；`bid-sample/`、`docs/` 在仓内
- #7 squash 合入 main、#6 已关闭：接入墙与 CI 门禁在 main
- #5 squash 合入 main（4dd50a1）、#1 已关闭：MQTT recognition 与 HTTP 同管道

## 视觉口径（与 Issue #2 一致）
- 看板与指挥大屏：清亮农作物监控风格（农业场景）。暗色可选，不是验收硬约束。不以公安 / 雪亮类比作为验收。

## 进行中
- #2 大屏：指挥页路由 + 五区布局（清亮农作物风格）；`/big-screen` 五区接现有 list/alert/device API（允许空态）。暗色可选。（#2，`status:doing`）

## 待开
- #3 管理端四页（设备 / 告警 / 采摘 / 报表接通 API），排在 #2 之后
- #4 指挥台 `status.json` 对齐（仓：https://github.com/lijiaaaaa-bot/mushroom-project-console）

## 阻塞
- 无
