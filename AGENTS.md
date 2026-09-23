# 食用菌种植管理平台

## 目标（一句话）
食用菌基地 IoT/AI 结果汇聚：接入、告警闭环、大屏与台账；不做端侧 CV 训练。

## 技术栈（一行）
NestJS + Vue3/TS/Vite/Tailwind + PostgreSQL/Redis/MinIO + MQTT；契约 `packages/contracts`。

## 统一入口
- 测试：`make test`
- 文档闸：`make gates`（exit 0 才算文档过关）
- 门禁自测：`make gates-selftest`
- 事实源：根目录 `facts.json`、已合并 PR、关闭的 Issue、`STATUS.md`

## 上游 Day-0
- 包：`project-harness-day0` v0.1.0，https://github.com/lijiaaaaa-bot/project-harness-day0
- 门禁、协议、agent 规范、检出结构先改 harness；本仓是消费方，禁止只在本仓补故事
- 其他项目 Day-0：按 harness `INSTALL.md` 拷贝
- 本仓仍跑本地 `make gates`；快照说明见 `docs/HARNESS.md`

## 上下文纪律（2026-06～09 窗）
- 默认少给：近端高保真 + 远端摘要；禁止每轮灌全聊天
- JIT：大材料只给路径，用工具再读
- 压缩：子任务结束再折；推导中不压；规则 elision 优先于 LLM 摘要
- 独立判断：新会话/子 agent；主会话只收摘要
- 完成 = test/gates/PR，不是自评

## 禁止
- 文件名/标题用「独立/好看/完美」等元词
- 把需求原文（如 110 路摄像头）标成假定
- 无证据的完成百分比

## 会话协议
- 开场 / 进行 / 收工：`docs/SESSION_PROTOCOL.md`
- 研究对照（做 / 不做）：`docs/APPLY_MAP.md`
- 增量条目：`docs/CONTEXT_PLAYBOOK.md`
- 窗外记忆（只追加）：`agent-progress.md`
- Overnight 工单（完成看谓词，不看时长）：`docs/OVERNIGHT_TICKET.md`

## 延伸阅读（仓内）
- `docs/HARNESS.md`
- `docs/CONTEXT_ENGINEERING_2026_Jun-Sep.md`
- `docs/PROJECT_DELIVERABLE_NORMS.md`
