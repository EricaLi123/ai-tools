# Windows Terminal Tab 颜色演进

## 这页保留什么

- 为什么最后采用“直接写 OSC + 独立 watcher”的方案。
- 哪些看起来更简单或更官方的路线已经被真实机器否决。
- 哪些约束不是实现细节，而是会直接改变方案边界。

## 不可丢的前提

这轮实现里，用户约束一直很明确：

- 不做纯定时自动恢复。
- 不接受污染当前输入行的方案。
- 不接受会影响当前交互的方案。
- 需要证据链，而不是“理论上应该可以”。

这些约束决定了“只要能清颜色就行”并不成立；恢复方式本身也必须可接受。

## 当时先确认的事实

早期排查先确认了几件足以决定方向的事实：

1. `shellPid` 最终可以拿对，日志与手工 `echo $PID` 能对上。
2. 手工在前台 PowerShell 输出 reset OSC 可以恢复颜色。
3. `cli.js` 直接往当前 `stdout/stderr` 写设色 OSC，手工执行场景可以让当前 Tab 变色。
4. Windows Terminal action / keybinding 这条路在当时那台机器上不可靠，手工触发也不能稳定清色。

真正有用的结论不是“官方支持什么”，而是“哪条通路在这台真实机器上真的生效”。

## 明确放弃过的路线

### 1. Windows Terminal action / keybinding

思路是往 WT `settings.json` 注入 action，再由 watcher 触发热键调用 `setTabColor(null)`。

放弃原因：

- 用户手工按快捷键都不能清掉颜色。
- 自动触发失败时，也没有证据表明问题只在热键模拟层。
- 说明在这台机器上，WT action 并不是清除这类颜色的可靠路径。

### 2. 前台 PowerShell 命令注入

思路是 watcher 检测到用户回来后，往前台 shell 注入一条极短命令，让它自己输出 `OSC 104;264`。

放弃原因：

- 会污染当前输入行。
- 会打断用户正在做的事。
- 与用户明确约束冲突。

### 3. Node 直接 detached spawn watcher

思路是 `cli.js` 自己 `spawn(..., detached: true)` 拉起 watcher，并让它继承当前终端输出流。

放弃原因：

- Node 侧能拿到 child pid，但 watcher 自己没有稳定写出 `started` 日志。
- 说明这条启动链在目标机器上并不稳定。

### 4. 只用“前台窗口 + 最后输入时间”判定用户回来

这条路线一度看起来足够简单，但它会误伤同窗口多 Tab 场景：

- tab1 触发变色
- 用户停留在 tab2 输入
- tab1 却被误 reset

因为系统级 `last input tick` 不是按 console 分离的。

## 为什么最后回到“直接写 OSC”

真正决定方向的证据只有两条：

1. 手工 reset OSC 有效。
2. `cli.js` 直接写 set-color OSC 有效。

所以最终方案不再围绕“让别的层帮我清颜色”，而是围绕：

- 找到真正对应目标 Tab 的输出通道
- 直接把 OSC 写进去

## 最终收敛出的方案

### 设色

- `cli.js` 先尝试向当前 `stdout/stderr` 写 `OSC 4;264`
- 同时启动 watcher
- watcher 再通过 `AttachConsole(shellPid)` + `CONOUT$` 兜底写一遍设色 OSC

这样同时覆盖了两类场景：

- 手工执行时，当前标准流通常已经直连目标 Tab
- 异步 hook 场景里，这个假设未必成立，所以仍要靠 watcher 兜底

### watcher 启动

最终采用的是：

- `cli.js` 用 `spawnSync` 调 `start-tab-color-watcher.ps1`
- launcher 再用 `Start-Process -NoNewWindow` 启动 `tab-color-watcher.ps1`

后来又补了一次关键修正：

- 不再靠 launcher 的 `stdout` 回传 watcher pid
- 改为让 launcher 写临时 pid 文件

因为 watcher 继承句柄后，前一种做法会让 `spawnSync` 卡住。

### reset 条件

最终 reset 不是“窗口回来就清”，而是同时满足：

1. 目标 WT 窗口重新成为前台
2. 系统最后输入时间发生变化
3. 目标 console 自己的 `CONIN$` 收到新输入

第 3 条是这套方案成立的关键，因为它避免了“同窗口别的 Tab 输入导致误清色”。

### reset 执行

reset 也走双通道：

- 先尝试标准流
- 再尝试附着后的 `CONOUT$`

对应序列是：

```text
ESC ] 104 ; 264 ESC \
```

也就是清掉 `FRAME_BACKGROUND` 覆盖色。

## 最后留下来的经验

- 不要把“理论上是官方路径”误当成“在用户机器上一定可用”。
- 终端 / 控制台问题优先找真实生效的通路，再谈抽象设计。
- 用户约束不是最后补充项，而是方案边界的一部分。
- 多 Tab 问题本质上是 console 级问题，不是单纯窗口级问题。
- 进程启动链是否稳定，必须以日志和端到端行为为准。
