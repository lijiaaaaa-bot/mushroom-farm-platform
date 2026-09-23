# Agent progress（外置会话记忆）

> 写在窗外，按条追加；禁止整份重写成空话摘要。

## 当前
- 本会话目标：Issue #26 病害列表与可打开抓拍（分支 overnight/mvp-disease-snapshots）
- 进行中文件：apps/web DiseasesView、RecognitionsView 抓拍列；apps/api GET /diseases 与 snapshot 代理

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
| 2026-09-23 | #26 病害页与抓拍打开：GET /diseases 过滤 diseaseCount>0；GET /ingest/recognitions/:id/snapshot 读 MinIO 或原图 URL；棚隔离仍走 ShedScope | `make test` 与 `make gates` 退出码见本 PR；不关 Issue #26 | PR 未合 |
