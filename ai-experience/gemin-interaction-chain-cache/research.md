# 研究过程

## 目标

验证 Gemini Interactions API 在 system instruction、schema 和生成参数完全相同时，能否通过 `previous_interaction_id` 对长对话上下文触发隐式缓存，并观察连续请求中 cached tokens 的变化。

## 请求合同

脚本只构造一次 system instruction、Structured Output schema 和 generation config，四轮直接复用同一合同对象。规范化合同的 SHA-256 为：

```text
bc7fbe4426d9958f77cbab21fb97994764449f8fa580e14de354bbbf9128b11b
```

各轮只改变 user prompt：

1. 生成长作文。
2. 概括为不超过 10 个中文汉字的摘要。
3. 基于摘要生成不超过 30 个中文汉字的宣传语。
4. 基于宣传语生成不超过 20 个中文汉字的短标题。

## 实验记录

| 时间目录 | 请求形状 | 关键结果 | 说明 |
|---|---|---|---|
| `20260731T040900Z-...` | 第一轮 | `APIConnectionError` | 连接失败，仅有 manifest |
| `20260731T041152Z-...` | 第一轮 | `APIConnectionError` | 连接失败，仅有 manifest |
| `20260731T041439Z-...` | 两轮链 | R1 output 4607；R2 input 4759、cached 0 | 第二轮首次引入长输出，没有命中 |
| `20260731T054022Z-...` | 两个相同分支 | R2/R3 input 均为 4308；R3 cached 2004 | R2、R3 都以 R1 为 parent，证明重复长前缀可部分命中 |
| `20260731T055537Z-...` | 三轮连续链 | R2 input 4528、cached 0；R3 input 4584、cached 2003 | R3 以 R2 为 parent |
| `20260731T055558Z-...` | 被中止 | status 为 `running` | 并发实验清理后保留的 manifest，不作为结果 |
| `20260731T055652Z-...` | 三轮连续链 | R2 input 4265、cached 0；R3 input 4320、cached 2000 | R3 input 增加 55，确认继承 R2 上下文 |
| `20260731T061639Z-...` | 四轮连续链，6000 字 | R1 output 3532；R2-R4 cached 均为 0 | 长输入未达到 4096-token 观察门槛 |
| `20260731T061802Z-...` | 四轮连续链，8000 字 | R3 cached 2000；R4 cached 1997 | 短 prompt 有效结果 |
| `20260731T075720Z-...` | 第一轮长 prompt 四轮链 | R1 input 5576、thinking 0；R2/R3 cached 0；R4 cached 8112 | 验证 thinking 缺失假设 |
| `20260731T080612Z-...` | 长 prompt，每轮等待 10 秒 | R1 input 5576；R2-R4 cached 均为 0 | 10 秒等待未改善命中 |

完整目录名和文件状态见 [output/README.md](output/README.md)。

## 四轮有效结果

使用 `--essay-chars 8000`：

| 轮次 | Input | Output | Cached | Thinking |
|---|---:|---:|---:|---:|
| 第一轮 | 118 | 4102 | 0 | 1021 |
| 第二轮 | 4253 | 17 | 0 | 0 |
| 第三轮 | 4307 | 27 | 2000 | 0 |
| 第四轮 | 4371 | 19 | 1997 | 0 |

输出内容：

- 第二轮：`图书馆的一天：知识灯塔`
- 第三轮：`在知识灯塔中寻找光芒，让阅读点亮城市每一个昼夜。`
- 第四轮：`城市灯塔：图书馆的昼与夜`

## 结论

### 第二轮为何没有命中

第一轮真正的 input 只有约 118 tokens，由 system instruction、schema 和第一轮 user prompt 构成。长作文和 thinking 是第一轮生成阶段的结果，不是第一轮开始时已有的长 input。

第二轮第一次把第一轮可见输出作为长 input 引入，因此没有此前相同的长输入缓存可读。第二轮处理该长输入后，第三轮才出现部分缓存命中。

### Thinking 的影响

脚本设置 `thinking_level=low`。有效四轮实验中，第一轮产生 1021 thinking tokens，但第二轮 input 只有 4253 tokens，说明 thinking tokens 没有作为普通可见文本完整加入后续上下文。

这不是第二轮未命中的主要解释。即使模型内部在第一轮依次生成 thinking 和可见输出，API 报告的第一轮 input 仍只有 118 tokens；第二轮才是长历史首次成为请求 input。

### 为何只命中约 2000 tokens

隐式缓存是服务端自动、尽力而为的优化。`total_cached_tokens` 表示本轮实际复用的输入 token 数，不表示公共前缀长度。后端可能只缓存或复用部分前缀和内部块，API 不承诺整个输入都被缓存，也不公开具体分块策略。

第三轮 input 为 4307、cached 为 2000；第四轮 input 增长到 4371，cached 反而变为 1997。这说明不能把隐式缓存理解为“每轮把新增上下文继续追加到同一份完整缓存”。

## 使用建议

- 把稳定且较长的公共内容放在输入前部。
- 通过 `total_cached_tokens` 记录真实命中，不根据请求相同自行推断。
- 隐式缓存只用于费用和延迟优化，不应成为业务正确性的前提。
- 需要稳定、明确控制缓存内容时，评估 explicit context caching。

## 第一轮长 Prompt 实验

为验证“第一轮可能已建立包含 thinking 的缓存，但第二轮缺少 thinking 导致前缀不一致”这一假设，第一轮 user prompt 被确定性扩展到至少 8000 个字符。这样第一轮在生成任何 thinking 和可见输出之前，input 本身就达到缓存观察门槛。

实际结果：

| 轮次 | Input | Output | Cached | Thinking |
|---|---:|---:|---:|---:|
| 第一轮 | 5576 | 5527 | 0 | 0 |
| 第二轮 | 11135 | 18 | 0 | 0 |
| 第三轮 | 11190 | 31 | 0 | 0 |
| 第四轮 | 11258 | 21 | 8112 | 375 |

第一轮实际 prompt 为 8005 个字符。第一轮 thinking 恰好为 0，但第二轮仍未命中，因此缺少第一轮 thinking 不是缓存未命中的必要条件。第三轮也未命中，第四轮才命中 8112 tokens，缓存覆盖率约为 `72.06%`。

该结果不能证明后端一定在第三轮建立缓存，也不能证明 thinking 永远不影响内部前缀；它只能说明即使没有第一轮 thinking，满足长度门槛的相同输入前缀也不保证下一轮立即命中。隐式缓存仍具有异步、动态或尽力而为的表现。

结果目录：`output/20260731T075720Z-70c8180f-33b0-47b4-a726-1796f67eb55f/`。

## 10 秒轮间等待实验

在相同长 prompt 四轮链中，R1→R2、R2→R3、R3→R4 各等待 10 秒：

| 轮次 | Input | Output | Cached | Thinking |
|---|---:|---:|---:|---:|
| 第一轮 | 5576 | 4014 | 0 | 0 |
| 第二轮 | 9622 | 15 | 0 | 0 |
| 第三轮 | 9674 | 31 | 0 | 575 |
| 第四轮 | 9742 | 19 | 0 | 0 |

三次等待后仍无任何缓存命中。该结果不支持“只要等待 10 秒，下一轮就能读取异步建立的缓存”，也说明上一组第四轮命中 8112 tokens 不能仅用固定传播延迟解释。

单次结果不能证明等待时间完全无效。更准确的结论是：隐式缓存是否建立和可读仍具有明显不确定性，可能同时受到后端选择、请求路由、缓存分片和生命周期策略影响。

结果目录：`output/20260731T080612Z-96b2cb2e-693d-4b9f-b93c-b23e30d5381e/`。

## 官方资料核对

2026-07-31 核对 Google 官方文档，Context caching 页面最后更新于 2026-07-30。

官方规则：

- Interactions API 只支持 implicit caching，不支持手动创建和引用 explicit cache。
- implicit caching 默认用于 Gemini 2.5 及更新模型，同时支持 stateful `previous_interaction_id` 和 stateless 完整历史。
- `previous_interaction_id` 会让服务端取回完整会话历史。Interaction 历史步骤包括 model thoughts、工具调用、工具结果和最终 model output；并非简单丢弃 thinking 后重新拼接可见文本。
- system instruction、tools、generation config 等参数不会随 `previous_interaction_id` 继承，必须每轮重新指定。本脚本已经保持这些参数一致。
- 官方只建议把较大且相同的内容放在 prompt 前部，并在较短时间内发送相似前缀请求；原文是“increase the chance”，没有承诺达到门槛后必定命中。
- 当前最低 token 表列出 Gemini 3.5 Flash 为 4096、Gemini 3.1 Pro Preview 为 4096、Gemini 2.5 Flash/Pro 为 2048，没有列出 `gemini-3-flash-preview`。
- `gemini-3-flash-preview` 模型页标明 Caching Supported，但没有给出该 Preview 型号的明确最低 token 数或命中保证。

官方社区中有多条相同现象报告：超过最低 token 数、重复相同前缀后仍然不命中，或命中率随时间明显波动。针对 Gemini 3 Flash 的社区实测称首次命中约在 4192 tokens，但这不是 Google 的正式保证。我们的第一轮 input 为 5576 tokens，仍出现第二至第四轮全部未命中的运行，与社区报告一致。

资料：

- [Context caching](https://ai.google.dev/gemini-api/docs/caching)
- [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Gemini 3 Flash Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview)
- [Gemini 3 Flash 社区命中讨论](https://discuss.ai.google.dev/t/has-anyone-gotten-implicit-caching-to-work/142699)

## 如何稳定使用缓存

### 需要确定性缓存

不要使用 Interactions API 的 implicit caching 作为前提，改用 `generateContent` API 的 explicit caching：

1. 第一轮完成后，由客户端保存第一轮 user input 和 model output。
2. 使用这些稳定历史创建 explicit cache，并设置 TTL。
3. 第二轮及后续请求显式引用该 cache，只发送新增 user 内容。
4. system instruction、schema 和生成参数继续保持一致。

Interactions API 当前不能引用 explicit cache，因此要获得可控命中，必须放弃 `previous_interaction_id` 的服务端会话链，改由应用维护历史并调用 `generateContent`。

### 继续使用 Interactions API

只能提高概率，不能保证命中：

- 优先改用最低门槛有官方记录的稳定模型，例如 `gemini-3.5-flash`，不要以 Preview 模型作为缓存行为基准。
- 把大段稳定公共内容放在 user prompt 最前面。
- 不要把随机 UUID 放在公共前缀之前。可使用固定的业务 scope，例如 `essay-chain-cache-v1`，把 run ID 放在稳定长前缀之后。
- 多个请求保持相同 model、system instruction、tools、schema 和 generation config。
- 在短时间内发送相同前缀请求，并根据 `usage.total_cached_tokens` 接受实际命中结果。
- 即使满足以上条件，仍要按未命中设计费用和延迟预算。
