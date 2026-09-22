# 插件如何结合 VS Code：C++ server 与双 IDE 调试

可运行工程和操作步骤：[examples/cpp-debug-server](../../examples/cpp-debug-server/README.md)。这是独立示例，不修改现有扩展协议实现，不依赖 Unreal。

## 1. VS Code 与 C++ 并非直接相连

```text
Visual Studio 原生调试器
  └─ 调试 as-debug-server.exe 的 C++ 函数、内存、调用栈
       ▲
       │ 自定义二进制 TCP（示例 127.0.0.1:27100）
       │
VS Code 的 Debug UI
  → 标准 DAP 请求
  → 本仓库 ASDebugSession（TypeScript）
  → unreal-debugclient.ts 编码/解码
  → as-debug-server.exe
```

C++ server **不需要实现 DAP 的 Content-Length/JSON**，因为插件已经承担转换。若绕开插件直接给 C++ 写一个标准 DAP server，那是另一套接入方式，不是本例。

## 2. 插件挂入 VS Code 的四个环节

| 环节 | 本仓库实现 | 作用 |
| --- | --- | --- |
| 扩展清单 | 根 package.json 的 languages/grammars/debuggers/commands | 注册 `.as`、语言着色、`type: angelscript` 调试配置与按钮 |
| 激活 | extension.ts 的 activate | 启动 LanguageClient，注册调试配置 provider、hover 求值表达式选择器等 |
| 启动调试会话 | ASConfigurationProvider.resolveDebugConfiguration | 创建本地随机端口 DAP listener；每条 DAP socket 创建 ASDebugSession |
| 实际调试 | debug.ts 的 ASDebugSession | 把 DAP 请求转换为 Unreal 自定义 TCP 消息，并把回复转换成 VS Code UI 数据 |

所以脚本工作区的 launch.json 使用：

```json
{
  "type": "angelscript",
  "request": "launch",
  "name": "Connect to C++ demo",
  "hostname": "127.0.0.1",
  "port": 27100,
  "trace": true
}
```

- 不要改成 `cppvsdbg`：那会选择 VS Code 的 C++ 原生调试器，而不是本插件。
- 不要增加 `debugServer: 27100`：这个字段是 **VS Code → DAP adapter** 的端口，由 provider 填写；27100 是 **adapter → C++** 的端口。
- 不需要在这里填 `.exe` 的 program：本插件的 launch 是连接已运行服务，不负责启动 C++。
- 想同时让补全连到示例，还要将 `UnrealAngelscript.unrealConnectionPort` 设置为 27100；它与 launch.port 是两个配置入口。

## 3. 按一次 F5 实际发生什么

```text
VS Code                         TS adapter                         C++ demo
initialize -------------------> initializeRequest
                                  RequestBreakFilters ------------>
                                  <---------------- BreakFilters(0)
                                  断开这条临时 TCP 连接
<-------- initialize response + initialized event
launch -----------------------> launchRequest
                                  新 TCP 连接，StartDebugging(2) --->
                                  <--------- DebugServerVersion(1)
                                  <---------------- HasStopped(entry)
setBreakpoints ---------------> clearBreakpoints / setBreakpoint --->
                                  <---------------- SetBreakpoint 回执
configurationDone ------------> 解除 launch 等待
<----------------------------- launch response
stackTrace / scopes / variables / evaluate ...
```

stopped、配置请求与 launch response 可异步交错；C++ 协议没有 configurationDone 消息。本例收到 StartDebugging 后重置并停在入口，TS adapter 负责 VS Code 的配置握手。

因此 C++ server 必须循环 accept，不能处理完初始化过滤器连接就退出；还要允许 LSP 长连接同时存在。

## 4. VS Code UI 是怎么填出来的

| UI/操作 | DAP 请求 | C++ 消息/返回 |
| --- | --- | --- |
| 行号栏断点 | setBreakpoints | ClearBreakpoints + SetBreakpoint；回传真实可执行行和 id |
| 黄色当前行、Call Stack | stackTrace | RequestCallStack；函数名、源码路径、行号、模块名 |
| Variables 三个 scope | scopes（adapter 本地构造） | 转成 `0:%local%` / `0:%this%` / `0:%module%` 等句柄 |
| 展开变量 | variables | RequestVariables(path)；name/value/type/hasMembers |
| Watch / hover / Debug Console | evaluate | RequestEvaluate(expression, frameId)；结果和是否可展开 |
| F5/F10/F11/Shift+F11 | continue/next/stepIn/stepOut | Continue/StepOver/StepIn/StepOut |
| 暂停按钮 | pause | Pause → HasStopped(pause) |

C++ 不会直接绘制 VS Code 面板。它提供源映射、值与运行状态，adapter 把这些组装成 StackFrame、Scope、Variable、StoppedEvent 等。

## 5. 双 IDE 配合的关键规则

**脚本暂停 ≠ 原生进程暂停。**

本例在脚本断点处设置 `client.running=false` 并发 HasStopped。网络循环仍然运行，因而 VS Code 还能发送栈、变量、Watch 请求。

若在 C++ 的断点命中处直接调用 `DebugBreak()`，Visual Studio 会暂停整个进程，TCP 请求也无法被处理。真实 VM 中应暂停脚本执行线程/状态机，但保留调试通信线程或消息泵。

手工观察路径：

1. VS 先运行 C++，VS Code 再连接并停在脚本调用行。
2. 在 VS 的 RequestEvaluate 分支设原生断点。
3. VS Code 增加 Watch `Counter`，请求使 VS 停住。
4. VS 查看 expression、frame、client.runtime.counter，然后 **在 VS 按 F5**。
5. 回复发出后，VS Code Watch 才显示值。

若 VS Code 显示“正在加载变量”，先看 VS 是否正停在原生断点，不要先重写协议。

## 6. 补全是另一条并行链路

```text
VS Code 编辑 .as
  → LSP 请求 → language-server
  → 本地 parser + 类型数据库 → CompletionItem
                    ▲
                    └─ C++ demo 的 RequestDebugDatabase / DebugDatabase / Finished
```

本例提供 native FDemoState、Demo::State、Demo::Print 的元数据，语言服务才知道成员与参数。源码 Add/Main 来自本地 `.as` 解析。

这不依赖正在进行 DAP 调试，也不读取 C++ 的局部变量内存。保存脚本不会触发本例编译或重载；运行逻辑仍来自 DemoRuntime。

## 7. 验证范围与后续接 VM

示例已覆盖 TCP 帧、真实 ASDebugSession 的 DAP 链路和真实语言模块；GUI 验证仍需按工程 README 手工执行。

下一步接真实 AngelScript VM 时：

- 行回调提供 module/file/line，替换固定 pc；保留“下一条语句执行前暂停”的约定。
- 从真实栈深度实现 StepOver/StepOut，而不只把三个按钮都映射成继续。
- 断点按源码映射绑定可执行位置，并回报修正行号。
- 从暂停的上下文读取局部变量/参数/对象，处理帧生命周期和展开路径。
- 求值应定义支持范围，不能直接把不可信表达式当系统 shell/C++ 代码执行。
- 保持每个会话的接收缓冲和请求顺序；当前协议同类回复靠 FIFO 关联。

字节布局见 [debug server 协议](debug-server.md)，示例内部模块见 [server](../../examples/cpp-debug-server/docs/server.md)、[runtime](../../examples/cpp-debug-server/docs/runtime.md)、[protocol](../../examples/cpp-debug-server/docs/protocol.md)。
