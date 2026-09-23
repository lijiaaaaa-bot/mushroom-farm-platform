# 交付物门禁

完成 = `node scripts/gates/run-all.mjs` 退出码 0（等价于 `make gates`）。Skill、prompt、口头说明都不是墙；墙是这条命令的退出码。

`make test` 仍只跑契约、边界和单测。`make gates` 与它分开，由 CI workflow `deliverable-gates` 在 pull request 和 `main` / `master` push 上执行。

`facts.json` 从需求原文填写：把原文已经写明的规模、通道、角色等放进 `facts`。这些事实在文稿里按事实写，不要和【假定】或【假设】写在同一行。样例 JSON 以后放进 `json_samples`，门禁只检查文件存在且可 `JSON.parse`。

上下文纪律见根目录 [`AGENTS.md`](../AGENTS.md)；2026 年 6–9 月讨论见 [`CONTEXT_ENGINEERING_2026_Jun-Sep.md`](./CONTEXT_ENGINEERING_2026_Jun-Sep.md)。

当前门禁：

- 文件名和一级标题不得含禁用元词（见 `facts.json` 的 `forbidden_name_substrings`）。
- 需求事实关键词不得与【假定】/【假设】出现在同一行。
- 禁止无证据的完成百分比（`完成 N%`、`N% 完成`、`进度 N%`）；写这条规则本身须带「禁止」「无证据」或「不编造」。
- `json_samples` 列出的文件必须可解析；清单为空时跳过。

## 同构翻车（必升规则）

发现表面合规或门禁漏报时：先抽出「坏在哪一类」，再同时做三件事——（1）更新 `facts.json` 或 `scripts/gates/run-all.mjs` 规则；（2）在 `scripts/gates/fixtures/` 加一条同构负例（或正例）；（3）`make gates-selftest` 必须绿。禁止只改那一份坏稿、不升规则。

## 上游 harness

元改动（门禁、协议、agent 规范、检出结构）先进入 [project-harness-day0](https://github.com/lijiaaaaa-bot/project-harness-day0) v0.1.0。本仓是消费方：禁止只改本仓故事或文稿、不回 harness。其他项目 Day-0 从该仓 `INSTALL.md` 拷贝。本仓 `scripts/gates` 继续由 `make gates` 执行。说明见 [`HARNESS.md`](./HARNESS.md)。
