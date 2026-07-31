# 关键问答

## 两轮除了 user prompt 和输出，其他是否完全一致？

是。model、system instruction、Structured Output schema、temperature、thinking level、max output tokens 和 `store=true` 都来自同一份合同对象。第二轮额外提供第一轮的 `previous_interaction_id`。

## 第二轮不是应该用 system、第一轮输入和输出触发缓存吗？

第二轮确实引入这些上下文，但这是长作文第一次作为请求 input 出现。第一轮开始时的 input 很短，第一轮生成的作文不是第一轮已有的 input cache。因此第二轮可能负责形成缓存候选，第三轮才有机会读取。

## 分支实验中，第三轮 input 为什么和第二轮一样？

当时第二轮和第三轮都使用第一轮作为 parent，并使用完全相同的 user prompt，所以两次请求形状相同，input 都是 4308 tokens。该结构后来改为严格连续链。

## 连续链中，第三轮 input 为什么增加？

第三轮以第二轮为 parent，因此上下文增加了第二轮 user prompt、第二轮模型输出和消息结构开销。一次实测中，input 从第二轮 4265 增加到第三轮 4320，共增加 55 tokens。

## 第三轮为什么只缓存约 2000 tokens？

隐式缓存支持部分命中。公共前缀大于 2000 tokens，不代表后端必须缓存全部公共前缀。具体缓存分块和保留范围由服务端决定，API 只报告实际复用量。

## 第四轮接在什么位置？

第四轮使用第三轮 Interaction ID：

```python
previous_interaction_id=third_interaction.id
```

有效实验中，第四轮 input 为 4371、cached 为 1997。缓存覆盖没有随着链路增长而扩大。

## Thinking level 是什么？

脚本设置为 `low`。`low` 不表示 thinking tokens 必定为 0；长作文轮次实测产生过 1021、1139、1179、1298 thinking tokens，短任务轮次通常为 0。

## 第一轮 thinking 没进入第二轮，是否导致第二轮不命中？

短 prompt 实验无法完全排除这个可能。为直接验证，当前脚本把第一轮 user prompt 扩展到至少 8000 个字符，使第一轮 input 在生成 thinking 和可见输出之前就达到缓存门槛。第二轮是否命中第一轮输入前缀，可以用于判断缺少 thinking 是否会阻断前部缓存复用。

实测第一轮 input 为 5576 tokens、thinking 为 0，第二轮 cached 仍为 0，第三轮也为 0，第四轮才命中 8112 tokens。因此缺少第一轮 thinking 不是未命中的必要条件；达到长度门槛也不保证下一轮立即命中隐式缓存。

## `total_cached_tokens` 应如何理解？

它表示当前请求 input 中实际由缓存覆盖的 token 数。它不是缓存对象总大小，不是公共前缀总长度，也不保证下一轮得到相同数值。

## 每轮等待 10 秒是否能让缓存稳定命中？

本次不能。第一轮 input 为 5576 tokens，之后每轮等待 10 秒，但第二、三、四轮 cached 均为 0。上一组无等待实验曾在第四轮命中 8112 tokens，因此不能把命中时机简单归因于固定的异步传播时间。

## 网上资料显示到底如何命中？

Google 官方只承诺 implicit caching 默认启用，并给出提高命中概率的建议，不承诺达到 token 门槛后必定命中。Interactions API 的 `previous_interaction_id` 有助于复用历史，但仍然只是 implicit caching。

官方文档还说明 Interaction 历史包含 model thoughts。服务端通过 `previous_interaction_id` 取回历史，因此不能根据后续 input usage 没有计入 thinking tokens，就断定 thinking 被丢弃并破坏了缓存前缀。

## 怎样才能保证用上缓存？

Interactions API 不能保证。需要确定性时，应改用 `generateContent` API 的 explicit caching，由应用创建并显式引用 cache。继续使用 Interactions 时，只能改用官方明确列出缓存门槛的稳定模型、把稳定长内容放在 prompt 最前面、移除公共前缀前的随机 UUID，并接受单次不命中。
