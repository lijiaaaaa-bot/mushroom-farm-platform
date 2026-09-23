# Agent 会话协议（蘑菇仓落地）

> 把 2026-06～09 研究落到本仓可执行动作。不训练模型。

## 开场（每会话必做）
1. 确认仓根
2. 读 `STATUS.md`、最近 git log
3. 读 `agent-progress.md`（若无则创建）
4. 从 Issue/STATUS 选一条可验收工作，写进 progress「本会话目标」
5. 需要大材料时只记路径，再用工具读（JIT）

## 进行中（Less Context + SelfCompact）
- 上下文默认：近端工具结果保留；远端用短摘要（决策 / 文件路径 / 未决 / 失败原因）
- 可压缩时机：子任务验收完成、或准备换 Issue
- 禁止压缩时机：推导或改契约半截、复现 bug 未结束
- 规则 elision 优先：过 `make gates`；不要靠长文自我约束

## 收工（每会话必做）
1. 动过 docs/facts 则 `make gates`；相关代码跑 `make test`
2. 提交描述写清「做了什么 / 怎么验」
3. 追加 `agent-progress.md`：完成项、未决、下一人手路径
4. 状态变了则更新 `STATUS.md` 一行
5. 聊天只指 PR/Issue/STATUS，不当交付物

## 独立判断
新会话或子 agent：只给需求原文或只给仓；不给主会话结论。主会话只收摘要。

## 外评（非自评）
完成 = CI 绿 + Issue 验收勾过；禁止「我觉得做完了」。
