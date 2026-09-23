# 上下文工程：2026年6–9月最新讨论与方案

> 时间窗（按用户指定）：**2026-06、07、08、09**。  
> 本页只收录该窗内论文/工程文/产业实践；2–5 月材料不作为「最新」。  
> 整理日：2026-09-23（Asia/Shanghai）。

## 窗内共识（一句话）

**更少、更干净的上下文往往更好**；压缩要从「到 token 阈值再砍」升级为「在语义里程碑主动折叠」；记忆用**外置状态 + 增量条目**，禁止整份重写成越来越短的空摘要；生产侧要观测「压缩后是否花更多步把状态找回来」。

---

## 2026-06

### 1. Less Context, Better Agents（arXiv:2606.10209）
- **谁**：Lodha 等；Dynamics 365 酒店费用分项、50 任务、重工具轨迹。  
- **结果（同 agent 只改历史策略）**：  
  - 全量历史：完成 **71%**，token 最高、最慢  
  - 只留最近 5 对 tool：完成 **79%**，token 约 1/3  
  - **剪枝 + 摘要**：**91.6%**，更快更省  
- **可落地**：默认不要「全聊天灌进下一轮」；保留近端高保真 + 远端短摘要（决策/ID/路径/未决）。

### 2. SelfCompact / Self-Compacting Language Model Agents（约 2026-06）
- **点**：固定 token 阈值压缩会打在「推导半截」上，最贵。  
- **方案**：给模型一个 **compaction 工具** + **轻量 rubric**（子任务结束/收敛 → 可压；推导中/卡住 → 禁止压）。无需微调。  
- **结果**：相对无摘要基线，数学最高约 +18.1，搜索约 +5–9，且题均成本降约 30–70%。  
- **可落地**：压缩是**决策**不是阈值；你的 harness 应暴露「折叠上下文」动作 + 何时禁止。

### 3. VISTA（常与 6 月文一并引用，arXiv:2606.30005）
- 工作记忆做成可寻址块；模型可 eviction/archive/restore。  
- 报道：LOCA-Bench 上 Gemini-3-Flash 从 22.7% → 50.7%（训练免费）。  
- **可落地**：外置块状记忆 + 仪表盘，优于单一滚动 transcript。

### 4. 产业综述（2026-06，Andrei Nita 等）
- 把 context engineering 写成生产纪律：Write/Select/Compress/Isolate 仍是操作骨架；强调可观测与数据质量。

---

## 2026-07

### 5. CompactionRL（arXiv:2607.05378）
- 把 compaction **写进 RL rollout**：接近窗限 → 策略生成摘要 → 用摘要+短尾续跑；任务奖励同时优化执行与摘要。  
- 开源模型上 SWE-bench Verified / Terminal-Bench 有稳定点数提升。  
- **可落地**：长期看「会压上下文」可训练；短期仍可用 SelfCompact 式工具+rubric。

### 6. 实践文（如 danilchenko.dev 2026-07-28）
- 把 6 月论文翻译成工程口令：prune、compact、isolate subagent、外置笔记。

---

## 2026-08

### 7. What Does Context Compression Cost an Agent?（arXiv:2608.16370）
- **观点**：只看「任务是否完成」会漏掉代价——压缩后 agent 用大量交互 **重新取回** 丢掉的状态。  
- **可落地**：压缩策略要保「执行相关状态」（路径、约束、未闭环 bug、契约 ID）；观测 **reacquisition tool-calls**，不只看 pass rate。

---

## 2026-09

### 8. An Empirical Study of Harness Design for Coding Agents（arXiv:2609.20804，2026-09-17）
- 固定执行环，扫 **176** 组：上下文管理 × 窗预算 × planning × action space；SWE-Bench Verified + Terminal-Bench 2.1。  
- **结论摘要**：  
  1. 窗越紧，上下文管理越值钱，主收益是 **防 overflow**。  
  2. **先规则 elision，再 LLM 摘要** 综合效率最强；「可恢复的 elision」增加机器却几乎无精度收益。  
  3. Planning：弱模型像脚手架，强模型更像 **省成本**。  
  4. 弱 bash 模型受益于预置工具；强 bash 模型 bash-only 更便宜。  
- **可落地**：你的 gates/脚本式 elision（文件名黑名单、假定冲突）属于「规则层」；摘要放第二层。

### 9. 生产向讨论（同季）
- Splunk 等：生产失败常是 **context poisoning/distraction**，五模式：offload / isolate / retrieval / compaction / caching + 可观测。  
- LinkedIn CAPT（MCP）：组织上下文层——meta-tools 发现/取 schema/执行，避免把 1300+ 工具定义一次塞进窗口（**渐进披露**）。

---

## 对你任意项目的「6–9 月版」安装清单

1. **剪枝默认开**：每轮不全量历史；近端 N 步 + 摘要（Less Context）。  
2. **压缩有 rubric**：子任务结束才压；推导中不压（SelfCompact）。  
3. **规则 elision → 再摘要**（2609.20804）；你已有的 `make gates` / facts.json = 规则墙。  
4. **外置状态**：STATUS / progress / git / playbook 分条增量（呼应 ACE 精神；ACE 会议篇在窗外发表，但增量 playbook 仍适用）。  
5. **测 reacquisition**：压缩后若 tool 调用暴增，说明压丢了执行态（2608.16370）。  
6. **工具面渐进披露**：少而清晰；组织内用 MCP 搜索工具，勿一次挂全套。  
7. **Generator ≠ Evaluator**：完成靠外评（测试/gates/人用路径），不靠自评。

## 明确不放进「本窗最新」的（避免混淆）

- Anthropic 2025-09 context engineering 文、2026-03 long-running harness、2026-02 OpenAI compaction API：重要但 **早于 2026-06**，作背景即可。  
- ACE arXiv 初稿约 2025-10、ICLR 2026：主文不在 6–9 月「新发」窗内；增量 playbook 思想仍可吸收。

## 主要链接

- https://arxiv.org/abs/2606.10209  
- https://arxiv.org/abs/2607.05378  
- https://arxiv.org/html/2608.16370v1  
- https://arxiv.org/abs/2609.20804  
- https://www.danilchenko.dev/posts/context-engineering/  
- https://www.newsletter.swirlai.com/p/state-of-context-engineering-in-2026  
