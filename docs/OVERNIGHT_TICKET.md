# Overnight 工单

通宵跑是执行方式。完成只看谓词过或不过。工时、通宵次数、「感觉做完了」都不是完成。

口径来自 Grok Bot Galaxy / Lauren Tan：可核验的结束条件、隔离工作区、决策日志、卡住就停。本文件是本仓 Issue / PR 的填写模板，不改产品行为，也不改 `make gates` 规则。

## 四条支柱

### 1. 可核验收束谓词

写清「做完 = 下面每一条都能判 pass 或 fail」。

- 用命令与退出码、测试名、文件路径、CI job 名。
- 谓词在开工前写死。执行中只追加证据，不把失败项改成「差不多」。
- 禁止用时长当完成，例如「跑了一夜」「花了 N 小时」。

### 2. 隔离分支 / worktree

一条工单一个分支，或一个 `git worktree`。不在 `main` 上直接改，不和别的进行中工单共用同一工作树。

### 3. 决策日志

路径：`evidence/overnight-<slug>/decisions.tsv`

TSV，第一行是表头，之后只追加。列：

| 列 | 含义 |
|----|------|
| time | UTC，如 `2026-09-23T07:57:00Z` |
| phase | 阶段：scope / form / implement / verify / escape |
| decision | 决定了什么 |
| reason | 为什么 |
| evidence | 文件路径、命令、PR、日志 |
| result | accepted / rejected / stopped / pr-opened-unmerged |

### 4. 逃生口

卡住就停，在决策日志写 `phase=escape`：卡在哪、试过什么、为什么停。不得放宽谓词来换绿灯（不许删检查、不许把失败改成跳过、不许把「时长到了」写成完成）。

推分支并开 PR。禁止自动合并。合并由人做。

## Issue 正文（复制即用）

把 `<slug>` 换成小写短名。谓词按本条工单改写。

````markdown
## 完成谓词（pass/fail）

时长不是完成。下面每一条都必须能判过或不过：

- [ ] `<命令或检查>` 退出码 0 / 断言成立
- [ ] `<文件或 CI job>` 存在且内容符合谓词

## 隔离

- 分支：`overnight/<slug>`（或本仓约定的 `cursor/<slug>`）
- worktree：单独目录，或写明「本机仅此一个工作树」

## 决策日志

`evidence/overnight-<slug>/decisions.tsv`

列：`time` `phase` `decision` `reason` `evidence` `result`（TSV，只追加）

## 逃生口

- [ ] 卡住则停止，并在决策日志写明原因
- [ ] 不放宽谓词
- [ ] 只开 PR，不自动合并

## 范围

-

## 非目标

-
````

GitHub 上优先用 Issue 表单：`.github/ISSUE_TEMPLATE/overnight_task.yml`（名称「Overnight 工单」）。表单字段与上面四块相同，谓词、隔离、日志路径、逃生口为必填。

## PR 清单

开 PR 时贴上，并附谓词证据。不要勾「已合并」。

- [ ] 完成谓词逐条有证据（命令输出、文件路径或 CI）
- [ ] 证据目录 `evidence/overnight-<slug>/decisions.tsv` 已提交，关键决定各有一行
- [ ] 分支或 worktree 只服务这一条工单
- [ ] 未放宽谓词；若中途停止，日志里有 `phase=escape` 且写明原因
- [ ] PR 已推送，未自动合并
