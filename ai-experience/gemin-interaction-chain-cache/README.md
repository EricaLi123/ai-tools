# Gemini Interaction 链式隐式缓存实验

本目录保存 Gemini Interactions API 链式请求的缓存方案、可执行脚本、离线测试、研究过程、问答和完整调用输出。

## 当前方案

请求链为：

```text
第一轮长作文 -> 第二轮摘要 -> 第三轮宣传语 -> 第四轮短标题
```

后三轮分别使用上一轮的 `Interaction ID` 作为 `previous_interaction_id`。四轮直接复用同一份请求合同：

- model：默认 `gemini-3-flash-preview`
- system instruction：`完成用户需求。`
- Structured Output：`{ "content": "string" }`
- temperature：`0.1`
- thinking level：`low`
- max output tokens：`12000`
- `store=true`

system instruction 和 schema 很短。第一轮 user prompt 带随机 run ID，并默认扩展到至少 8000 个字符，使第一轮 input 自身达到缓存观察门槛。这样可以验证第二轮没有继承第一轮 thinking 时，是否仍能命中第一轮输入前缀。第一轮同时生成长文本，第三、四轮继续观察缓存覆盖变化。

每轮完成后默认等待 10 秒再发起下一轮，用于观察隐式缓存是否需要异步建立或传播。可通过 `--round-delay-seconds` 调整，设为 `0` 可恢复立即连续调用。

## 主要结论

- 第一轮 input 扩展到 5576 tokens 后，第二轮仍未命中；达到门槛不保证紧邻的下一轮立即命中。
- 该次第一轮 thinking 为 0，因此第二轮未命中不能归因于“后续上下文缺少第一轮 thinking”。
- 隐式缓存允许部分命中，不保证缓存整个公共前缀。
- 长 prompt 四轮实验中，第二、三轮 cached 为 0，第四轮命中 8112 tokens，说明缓存可用时机和覆盖量由后端动态决定。
- 后续加入每轮 10 秒等待，第二至第四轮仍全部未命中；固定短延迟不能保证缓存传播完成。
- Google 官方只承诺提高 implicit cache 命中概率。需要确定性缓存时，应改用 `generateContent` API 的 explicit caching；Interactions API 不支持 explicit cache。
- 第一轮 thinking tokens 不作为普通可见文本加入后续上下文。`thinking_level=low` 仍可能产生 thinking tokens。

详细过程见 [research.md](research.md)，讨论问答见 [qa.md](qa.md)。

## 文件

```text
demo.py          当前四轮实验脚本
test_demo.py     离线测试
research.md      方案、实验过程和结论
qa.md            关键问答
requirements.txt Python 依赖
output/          11 次真实调用的完整原始结果
```

每个成功运行目录包含 `manifest.json` 和各轮完整 `Interaction` JSON。Interaction 使用 `model_dump(mode="json", exclude_none=False)` 序列化，没有裁剪 steps、usage、thinking signature 或模型输出。

## 运行

安装依赖：

```powershell
python -m pip install -r requirements.txt
```

只展示脱敏请求摘要，不访问网络：

```powershell
python demo.py
```

真实调用：

```powershell
$env:GOOGLE_API_KEY = "..."
python demo.py --first-prompt-chars 8000 --round-delay-seconds 10 --execute
```

脚本也会读取 `D:\git\ai-tools\.env` 中的 `GOOGLE_API_KEY`。API Key 不会写入结果文件。`--execute` 会产生模型费用，并通过 `store=true` 在 Google 侧保存 Interaction 数据。

离线验证：

```powershell
python -m pytest test_demo.py -q
ruff check demo.py test_demo.py
```

## 官方资料

- [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Context caching](https://ai.google.dev/gemini-api/docs/caching)
