# debug.ts：DAP 调试会话

源码：[extension/src/debug.ts](../../extension/src/debug.ts)。核心类 `ASDebugSession extends LoggingDebugSession`；Unreal 通信委托给 [unreal-debugclient](unreal-debugclient.md)。

## 会话时序

```text
VS Code initialize
  → connect(Unreal) → RequestBreakFilters
  ← BreakFilters
  → disconnect 临时连接
  → initialize response + InitializedEvent
VS Code launch / 配置请求
  → 再次 connect → StartDebugging(adapterVersion=2)
  → 重放已缓存断点
  → 等 configurationDone（wait 参数 1000ms）→ launch response
调试中
  ← HasStopped → StoppedEvent → stack/scopes/variables/evaluate
VS Code disconnect
  → StopDebugging → Disconnect → 清理本地数据断点
```

initialize 等引擎返回过滤器才回复，没有在此实现完整无响应超时。启动连接失败时先排查 BreakFilters，不是先找 `.as` 解析错误。

## DAP 与 Unreal 映射

| DAP | 本地入口/Unreal 消息 |
| --- | --- |
| `setBreakpoints` | `setBreakPointsRequest` → ClearBreakpoints + SetBreakpoint |
| `setExceptionBreakpoints` | `setExceptionBreakPointsRequest` → BreakOptions |
| `threads` | 固定线程 ID=1，名称 Unreal Editor |
| `stackTrace` | RequestCallStack → `receiveCallStack` |
| `scopes` | 本地创建 Variables / this / Globals scope |
| `variables` | RequestVariables → `receiveVariables` |
| `evaluate` | RequestEvaluate → `receiveEvaluate` |
| `continue/pause/next/stepIn/stepOut` | Continue / Pause / StepOver / StepIn / StepOut |
| `exceptionInfo` | 返回上次 HasStopped 中的异常文本 |
| 自定义 `angelscript/stopPIE` | StopPIE |

`restartRequest` 当前只回复，不重启 Unreal/PIE；不能宣传为重启能力。当前未实现多线程、条件断点、logpoint、setVariable、反向调试等完整能力。

## 普通断点

以文件路径维护 `ASBreakpoint[]`，同一行复用 ID；一次设置先清除该文件旧断点再发新断点。当前读取 `args.lines`，没有消费条件/hitCondition/logMessage。

客户端先返回 `verified: true`，引擎的 SetBreakpoint 回包再校正：

- line = -1：无可执行代码，改为未验证。
- 行号移动：发送 changed 事件。
- 移动后与已有断点重叠：移除重复断点。

文件路径、模块名与大小写要一致，否则 `receiveBreakpoint` 可能匹配不到本地记录。

## 栈与源码映射

栈帧 ID 直接使用回包的序号；函数名去除 `_Implementation` 后缀。`debugServerVersion > 0` 时每帧额外读取 moduleName，先尝试原始 sourcePath，再用 `moduleName.split('.')` 转相对路径，在各 workspace root 下寻找 `.as`。

`sourcePath` 以 `::` 开头的帧按外部标签展示。适配器声明 debugger 行列从 1 开始；LSP 的 Position 从 0 开始，新增映射必须明确坐标系。

## 变量句柄与求值

DAP 数字 `variablesReference` 经 `Handles<string>` 映射到引擎路径，例如：

```text
0:%local%        第 0 栈帧局部变量
0:%this%         this
0:%module%       模块全局变量
0:%local%.Actor  成员路径
0:%local%.Items[0]  数组/容器元素
```

`combineExpression` 对 `[index]` 直接拼接，否则加 `.`。有子成员时才创建可展开句柄。名称以 `$` 结尾的变量展示为 method hint。

`waitingTraces`、`waitingVariableRequests`、`waitingEvaluateRequests` 分别以 **FIFO** 关联请求/回复；自定义协议没有在这里使用 request ID。不要让引擎同类回复乱序，或把新增并发请求直接混入旧队列。

## 版本与数据断点

- `debugAdapterVersion=2` 发给引擎；`debugServerVersion` 初始 0，由 DebugServerVersion 回包更新，两者不能混用。
- server version >0：栈帧带模块名。
- server version ≥2：变量带 uint64 地址与 int8 大小。
- 数据断点只允许 write、非零地址、1/2/4/8 字节，`canPersist=false`。
- 常量 `SUPPORTED_DATA_BREAKPOINT_COUNT=4` 只把前四个标为 verified；当前发送列表没有按 4 截断，扩展时应与引擎容量一起验证。
- hitCount 和是否在 C++ 触发来自 `UnrealAngelscript.dataBreakpoints.*`；线协议 hitCount 是 int8，配置数字不能无界使用。

## 扩展步骤

新增 DAP 功能先确认 initialize capability，再实现 request → send → event/receive → response 的完整路径；为断线、超时、旧服务器版本设计结果。新表达式语法还需检查 `extension.ts` 的 `ASEvaluateableExpressionProvider`。

模块级 socket/events 是共享状态，session 构造会 `removeAllListeners()`；当前不能按“天然支持多个并发调试会话”设计。更多字段及联调见 [协议指南](../guides/debug-server.md)。
