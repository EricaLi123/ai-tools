---
name: codex-new-hook
description: Use when the user explicitly asks to audit whether Codex now has newer official or native hook support that could replace this repository's watcher-, sidecar-, or notify-based handling for approval, need input, or task completion events.
---

# Codex New Hook

检查 Codex 是否已经提供新的官方方案，能替代当前仓库里基于 watcher、sidecar、notify 的一部分或全部实现。官方证据优先；没有官方证据，就明确说没有。

## 适用范围

只在用户显式提到 `codex-new-hook`，或明确要求“检查 Codex 是否已有新的原生 hook / 官方方案可替代当前实现”时使用。

默认目标是当前仓库这套 Codex 通知链，而不是泛泛讨论 Claude Code 或通用 hooks：

- 事件判定与终端解析：[codex-approval-notify.js](../../packages/ai-agent-notify/lib/codex-approval-notify.js)
- 会话监视与补发逻辑：[codex-session-watch-runner.js](../../packages/ai-agent-notify/lib/codex-session-watch-runner.js)
- 终端高亮与等待复位：[tab-color-watcher.ps1](../../packages/ai-agent-notify/scripts/tab-color-watcher.ps1)
- Windows 通知与闪烁：[notify.ps1](../../packages/ai-agent-notify/scripts/notify.ps1)

默认还要先尊重这个仓库已经写进文档的路线边界，而不是每次从零开始假设所有官方能力都还是候选项：

- approval 主路线与 owner 边界：[../../packages/ai-agent-notify/docs/codex-approval.md](../../packages/ai-agent-notify/docs/codex-approval.md)
- 整体架构与官方能力边界：[../../packages/ai-agent-notify/docs/architecture.md](../../packages/ai-agent-notify/docs/architecture.md)
- `app-server` 已被验证后否掉的历史归档：[../../packages/ai-agent-notify/docs/history/legacy-repo-codex-approval-notification-session-2026-03-18.md](../../packages/ai-agent-notify/docs/history/legacy-repo-codex-approval-notification-session-2026-03-18.md)

## 信息源规则

1. 先使用 `openai-docs` skill。
2. 优先查询官方 Codex / OpenAI 文档、配置参考、hooks 能力说明、官方发布说明。
3. 非官方资料只能作为补充，而且必须显式标注为“非官方旁证”。
4. 如果官方没有覆盖某个结论，直接写“未找到官方证据”，不要补推断。
5. 回答中使用具体日期，不要只写“最新”“最近”。

## 当前仓库的默认护栏

除非用户这次明确要求“重新评估已否决路线”，否则以下内容默认视为**当前仓库已确认的边界**，不能再被当成默认迁移建议：

- `app-server`：
  - 只能作为“官方存在的结构化事件接口”来描述。
  - 不能被写成这个仓库的默认迁移主线。
  - 原因不是“官方不存在”，而是这个仓库的根本需求是“用户配置一次后继续直接使用官方 `codex`”，而 `app-server` watcher 做不到全局旁听；见 `docs/codex-approval.md` 和历史归档。
- `tui.notifications`：
  - 只能作为 TUI 内建通知能力来描述。
  - 不能被写成这个仓库外部通知链、窗口定位、tab 高亮、闪烁、复位的替代方案。
- 单独 `notify`：
  - 只能按官方证据描述它当前覆盖的事件边界。
  - 不能因为官方有 `notify`，就把它写成 approval / need input / 整套通知链的替代方案。
  - 对当前仓库，如果结论仍依赖“单独 `notify` 就够了”，默认动作建议应倾向 `继续保持现状`，而不是迁移。

如果官方能力“存在”，但与你仓库已确认的主路线边界冲突，回答时必须明确区分两件事：

- `官方存在`
- `不适合作为当前仓库默认路线`

## 执行流程

1. 先重述本次要审计的时机或能力。
   例如：`approval`、`need input`、`task complete`、项目级 hooks、notify 替代、终端高亮替代。

2. 读取当前仓库里与本次问题直接相关的实现切片。
   不需要全仓扫描，只读与提问相关的 watcher / sidecar / notify 代码和文档。
   至少优先读：
   - `docs/codex-approval.md`
   - `docs/architecture.md`
   - 提问里如果提到 `app-server`，再读对应 `history/legacy-repo-*.md`

3. 查询官方一手资料。
   推荐优先搜索这些方向：
   - `Codex hooks.json`
   - `features.codex_hooks`
   - `Codex notify`
   - `Codex approval`
   - `Codex need input`
   - `Codex lifecycle hooks`

4. 把官方能力拆成两个维度：
   - 事件时机：官方到底覆盖了哪些生命周期事件
   - 能力边界：官方是否还提供会话、终端、窗口、系统通知、UI 高亮等配套能力

5. 先做一次“官方存在 vs 当前仓库适配性”的分离判断。
   尤其是：
   - `app-server` 是否只是“官方存在”，但已被当前仓库否决为默认主路线
   - `tui.notifications` 是否只是 TUI 自带提示，而不是当前仓库需要的外部通知链
   - `notify` 是否只是 completion 层面的能力，而不是 approval / need input 替代

6. 强制映射回当前实现的 4 层职责：
   - 事件检测
   - 会话 / 终端 / 窗口解析
   - OS 通知发送
   - 终端 tab 高亮 / 闪烁 / 等待复位

7. 对每一层都必须给出单独结论，只能使用以下三档之一：
   - `可直接替代`
   - `可部分替代`
   - `不可替代`

8. 最后必须给出唯一动作建议，只能是以下三类之一：
   - `继续保持现状`
   - `补充验证后再迁移`
   - `可以开始设计迁移`

9. 如果本次能拿到的官方新能力主要只有以下任一项，而没有额外官方证据证明能满足当前仓库的默认路线需求：
   - `app-server`
   - `tui.notifications`
   - 单独 `notify`
   那默认动作建议应是 `继续保持现状`。

## 输出格式

回答必须按下面结构输出：

**官方新能力**

- 列出已找到的官方能力、文档链接、对应日期

**与当前实现的映射**

- `事件检测`：`可直接替代` / `可部分替代` / `不可替代`
- `会话 / 终端 / 窗口解析`：`可直接替代` / `可部分替代` / `不可替代`
- `OS 通知发送`：`可直接替代` / `可部分替代` / `不可替代`
- `tab 高亮 / 闪烁 / 复位`：`可直接替代` / `可部分替代` / `不可替代`

**迁移建议**

- 给出唯一动作建议
- 如果建议迁移，必须明确是替代哪一层，不要写成整套全替

**证据边界**

- 明确写出哪些点有官方证据
- 哪些点没有官方证据，当前只能保持现状

## 禁止事项

- 仅凭 `features.codex_hooks` 这个配置名，就认定官方已经能替代当前 watcher / sidecar
- 仅凭“官方有 hooks”就直接建议迁移
- 把 `notify` 和 `approval` / `need input` 混为一谈
- 仅凭官方有 `app-server`，就把它写成当前仓库默认迁移路线
- 把 `tui.notifications` 写成当前仓库外部通知链或窗口 / tab 行为的替代方案
- 在当前仓库语境下，把“官方存在某能力”和“适合作为默认主路线”混为一谈
- 没有官方证据时，用经验猜测 Windows 终端、窗口定位、tab 高亮能力
- 不做 repo 映射，只给泛泛的产品介绍
