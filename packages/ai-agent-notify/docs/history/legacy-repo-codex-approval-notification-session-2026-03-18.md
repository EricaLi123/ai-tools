# 2026-03-18 legacy repo app-server approval 验证

这页记录的是旧仓库、旧包名时代的一次路线验证。文件名保留原样，只是为了方便从后续文档回链。

当时的仓库与包路径是：

- 仓库：`D:\Git\claude-code-tools`
- 包：`D:\Git\claude-code-tools\packages\claude-code-notify`

## 为什么还保留

这页之所以值得保留，不是因为里面的实现后来成了主路线，而是因为它把一件事验证得很清楚：

- `codex app-server` 能让你看到 approval 相关状态
- 但“单独拉起一个 watcher 去旁听别的 Codex 会话”并不能满足全局默认路线的需求

也正因为这次验证失败，后面主路线才进一步收敛到 `codex-session-watch`。

## 当时要回答的问题

在不 fork Codex、不 patch Codex 内部、也不额外引入运行时依赖的前提下，能不能只靠官方 `codex app-server` 做一个 approval watcher？

## 当时实际做了什么

那次实现增加了一个显式模式：

- `claude-code-notify codex-watch`

它会：

- 启动官方 `codex app-server`
- 发送 `initialize`
- 发送 `initialized`
- 通过 `thread/list` 做 bootstrap
- 监听 `thread/status/changed`
- 发现 `waitingOnApproval` 时复用现有通知链路

换句话说，当时实现本身并没有失败；失败的是它对应的路线边界。

## 验证里真正证明了什么

那轮验证确认了两件互相独立的事：

1. 官方 app-server 确实会给出 approval 相关状态，例如 `waitingOnApproval`
2. 独立启动的 watcher 只能稳定看到它自己那条 app-server 连接里的事件

关键的端到端结论是：

- 第二个独立的官方 `codex app-server` 实例能够看到真实 approval
- 后台 `codex-watch` 进程看不到那个外部会话的状态变化

也就是说，它不是“全局旁听器”，只是“自己那条连接的观察者”。

## 这次验证为什么否决了默认主路线

项目的根本需求不是“理论上能在某条连接里拿到 approval”，而是：

- 用户配置一次
- 之后继续直接使用官方 `codex`
- 不需要额外包一层宿主、包装器或自定义前端

`app-server watcher` 做不到这一点：

- 如果不包宿主，它看不到别的会话
- 如果要稳定拿到事件，通常就得把 Codex 放进额外一层

所以它不适合成为默认的全局 approval 路线。

## 这页今天还剩下的价值

- 说明 `app-server` 路线不是没试过，而是试过后被边界否决了
- 说明失败点在“方案边界”，不在“代码没写通”或“Windows 命令没配对”
- 给以后再次想把 `app-server` 拿回来当默认方案的人一个最短反证入口

## 后续影响

后来包里引入了 `codex-session-watch`，它才成为正常 Codex CLI 使用场景下的主 approval 路线。
