# unreal-debugclient.ts：调试 TCP 客户端

源码：[extension/src/unreal-debugclient.ts](../../extension/src/unreal-debugclient.ts)。

## 职责

把 DAP 层需要的操作编码为 Unreal 自定义消息，并把接收消息转为 EventEmitter 事件。它不了解 DAP response/request，也不负责变量 UI。

公开状态为模块级 `unreal` socket、`connected`、`events`；接收缓存 `pendingBuffer` 同样为模块级。

## 生命周期

- `connect(hostname, port)`：销毁旧连接、创建 socket；接收 data 后调用 `readMessages`。
- `disconnect()`：发送 Disconnect 并销毁 socket。
- error/close：销毁 socket，发 `Closed`；没有语言服务那样的 5 秒自动重连。
- `connected` 在 connect 调用时就设 true，不是 TCP 握手完成证明；error/close 路径也没有完整重置所有状态。

多会话、半包后重连、初始化过滤器的临时连接都可能涉及共享缓存。若重构，优先让 socket、buffer、events 随连接实例归属，不要只在 DAP 层新增 session 对象。

## 事件映射

| MessageType | 事件 |
| --- | --- |
| CallStack | `CallStack` |
| HasStopped / HasContinued | `Stopped` / `Continued` |
| Variables / Evaluate | `Variables` / `Evaluate` |
| BreakFilters | `BreakFilters` |
| SetBreakpoint | `SetBreakpoint` |
| ClearDataBreakpoints | `ClearDataBreakpoints` |
| DebugServerVersion | `DebugServerVersion` |

其他枚举值不等于已处理事件；LSP 所需 DebugDatabase、Diagnostics 由另一连接处理。

## 发送接口

- 会话/控制：`sendStartDebugging`、`sendStopDebugging`、`sendPause`、`sendContinue`、`sendStep*`、`sendStopPIE`。
- 查询：`sendRequestCallStack`、`sendRequestVariables(path)`、`sendRequestEvaluate(expression, frameId)`、`sendRequestBreakFilters`。
- 断点：`clearBreakpoints`、`setBreakpoint`、`setDataBreakpoints`、`sendBreakOptions`。
- `sendEngineBreak` 有编码实现，不代表当前 DAP restart 使用它。

`Message.readInt/readByte/readBool/readAddress/readString` 顺序推进 offset。bool 是 4 字节整数；address 是 8 字节 bigint，不可转 JS Number 保存地址。

## 新消息怎么接

1. 核对两个客户端枚举与 Unreal 端编号，追加而不是插入。
2. 编写 send 函数，按字段顺序编码，并写正确长度。
3. 在 data 分发增加事件。
4. 在 `ASDebugSession` 注册 handler、解码、发送 DAP 响应/事件。
5. 根据 debug server version 做条件读取；测试半包、多包、旧版本和断线。

**收包与发包长度语义在代码中不同，不能对称套用。** 完整格式、字符串编码限制见 [debug server 协议](../guides/debug-server.md)。另一份 codec 见 [unreal-buffers](../language-server/unreal-buffers.md)。
