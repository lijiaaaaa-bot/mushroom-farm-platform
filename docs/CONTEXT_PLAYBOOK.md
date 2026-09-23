# 上下文 Playbook（增量条目）

> 只允许追加 / 改单条 / 删单条；禁止整文件重写冲掉细节。

## 有用策略
- 改契约先动 `packages/contracts` 与 fixtures，再改 ingest
- 文档过闸：`make gates`；业务：`make test`
- 大屏视觉：清亮农作物；令牌写在 Issue 验收里

## 踩坑（带证据）
- 文件名带「独立」会被 gates 红灯（PR #11）
- 需求「110 路」与「假定」同句会红灯

## 待确认（真未决才留）
- Nest 是否换 Go（默认不换）
- 视觉壤色 vs 清亮最终令牌
