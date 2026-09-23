# 上下文工程（任意项目 Day-0）

> 行业收敛结论（Anthropic / OpenAI / LangChain / Cursor，2025–2026）：  
> **没有万能提示词**；顶尖做法叫 **Context Engineering**——每一轮只塞「最少、高信号」的 token。  
> 本文件是可拷进任意仓的落地清单；项目差异只在内容，不在方法。

## 0. 一条总原则（Anthropic）

> Find the **smallest** set of **high-signal** tokens that maximize the desired outcome.  
> 上下文是有限注意力预算；越长越容易 **context rot**（淹没关键信息）。

## 1. 四操作（LangChain 归纳，各家都在用）

| 操作 | 含义 | 你项目里怎么做 |
|------|------|----------------|
| **Write** | 把该记住的写到窗口外 | `STATUS.md` / `progress.txt` / git commit / `facts.json` / Issue |
| **Select** | 需要时再拉进窗口 | 工具读文件、grep、按 Issue 拉；禁止整库灌 prompt |
| **Compress** | 窗口将满时压缩 | 会话小结只保留决策/未决/路径；清掉可再取的大段 tool 输出 |
| **Isolate** | 拆开污染域 | 子 agent / 新会话做独立调查；主会话只收摘要 |

## 2. 顶尖公司分别钉死的做法

### Anthropic（工程博客权威源）
- **JIT（Just-in-time）**：只留路径/链接/查询句柄，运行时用工具再加载（Claude Code：glob/grep/读文件）。
- **混合**：极薄的常驻说明（如 `CLAUDE.md`/`AGENTS.md`）+ JIT 探索。
- **长任务 harness**：首会话 **Initializer** 建环境（功能清单 JSON、`progress`、init 脚本、首 commit）；之后每会话只做**增量**，结束时留下干净 git + progress。
- **不信自评**：功能是否完成靠可跑测试/人用路径验收，不是模型说「做完了」。
- **子 agent**：脏搜索在子上下文；只回传短摘要给主 agent。

### OpenAI（Agents SDK）
- **两套上下文分开**：`RunContext`（代码侧依赖/状态，**默认不对 LLM 可见**）vs 对话历史（LLM 可见）。
- 要让模型看见的东西，只能进：instructions / 本轮 input / **工具按需取** / retrieval。
- 长对话用 session + **compaction**；不要把应用密钥塞进会进历史的对象。

### Cursor（产品层）
- 仓内 `AGENTS.md`（可嵌套目录）= 薄常驻 Spec。
- 重活丢 **Cloud Agent**（干净 VM/分支）= Isolate。
- 规则按 glob 选进上下文，而不是永远全塞。

### 补充（学界 ACE 等）
- 可进化的是 **分条 playbook**（增量增删改），避免整份上下文被模型重写成越来越短的空摘要（context collapse）。

## 3. 任意新项目 Day-0 安装（拷贝即用）

1. 根目录放薄 `AGENTS.md`（见下模板）：目标、栈、怎么跑测试、禁止事项；**禁止**贴整份需求长文。  
2. 装 **verifier gates**（已有脚手架）：`facts.json` + `scripts/gates` + CI。  
3. 看板真相：`STATUS.md` / Issues / PR；聊天不算交付。  
4. 约定会话协议：  
   - 首会话 = Initializer（建 facts、STATUS、gates、功能清单若需要）  
   - 之后 = 读 progress/git → 选一条 → 做完 → commit + 写 progress  
5. 独立判断 / 方案 / 审计 = **新 agent 或空会话**，只给需求原文或只给仓，不给聊天结论。  
6. 大材料一律 JIT：路径进 prompt，内容用读工具。

## 4. `AGENTS.md` 薄模板（常驻，宜短）

```markdown
# <产品名>

## 目标（一句话）
## 技术栈（一行）
## 统一入口
- 开发/测试：`make …`
- 文档闸：`make gates`（exit 0 才算文档过关）

## 事实源（勿把聊天当事实）
- `facts.json`、contracts、已合并 PR、关闭的 Issue、STATUS.md

## 上下文纪律
- 默认少给；需要时再读文件
- 独立结论用新会话/子 agent；主会话只收摘要
- 完成 = 测试/gates/PR，不是自评

## 禁止
- 文件名/标题用「独立/好看/完美」等元词
- 把需求原文标成假定
- 无证据的完成百分比
```

## 5. 每轮调用「该塞什么」（决策表）

| 任务类型 | 应进上下文 | 不应进 |
|----------|------------|--------|
| 改一个模块 | 该模块文件 + 相关契约 + 本 Issue 验收 | 全仓 SRS、过往闲聊、别的模块 |
| 写方案 | 需求原文（或 facts）+ 空假设 | 「我们之前怎么做的」聊天结论 |
| 独立审计 | 仅公开仓/仅给定材料 | 主 bot 记忆与进度百分比 |
| 合并/验收 | CI 结果、diff、gates 输出 | 长篇自我表扬 |

## 6. 和「提示词 / skill」的关系

- Skill / AGENTS = **薄 Spec**（提醒装闸、提醒纪律）。  
- **墙** = gates、tests、PR。  
- 上下文工程管的是「这一轮喂什么」；验证器工程管的是「交出来算不算数」。两者一起用，缺一不可。

## 来源（调查用）

- Anthropic, *Effective context engineering for AI agents* (2025-09)  
- Anthropic, *Effective harnesses for long-running agents* (2025-11)  
- OpenAI Agents SDK: Context management / Sessions  
- LangChain: Context engineering — Write / Select / Compress / Isolate  
- Cursor Docs: AGENTS.md / Rules  

