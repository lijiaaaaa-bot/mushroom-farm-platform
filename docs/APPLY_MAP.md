# 研究 → 本仓落地对照

| 研究（2026-06～09） | 本仓落点 | 状态 |
|--------------------|----------|------|
| Less Context：剪枝+摘要 | SESSION_PROTOCOL 近端/远端规则；agent-progress 外置 | 本 PR |
| SelfCompact：决策式压缩 | SESSION_PROTOCOL 可压/禁压时机 | 本 PR |
| 规则 elision 再摘要 | make gates + facts.json | 已有（PR #11） |
| 压缩 reacquisition 成本 | progress 必写路径与未决，避免压丢执行态 | 本 PR |
| ACE-lite 增量 playbook | CONTEXT_PLAYBOOK.md 分条 | 本 PR |
| Generator≠Evaluator | 完成=CI/Issue；独立 agent 审计 | 流程已有 |
| CompactionRL 训练 | 不落地（要训模型） | 明确不做 |
| Sourcegraph MCP 代码图 | 仓小，暂不引第三方 | 明确不做 |
| OpenAI 服务端 compaction API | 由宿主会话产品处理，不进本业务仓 | 明确不做 |
| Overnight / Galaxy 工单：谓词、隔离、决策日志、逃生口 | `docs/OVERNIGHT_TICKET.md` | 本 PR |
