# main.cpp：网络循环与调试调度

源码：[src/main.cpp](../src/main.cpp)。仅标准 C++17 和平台 socket；Windows 使用 Winsock/WSAStartup/ws2_32，可由 Visual Studio 原生调试。

## 主循环

回环 listener → select → accept/recv → 每连接 pending buffer 拆帧 → handleMessage → tickRuntime。限制最多 16 个连接，写入有超时，单个坏包异常只关闭其连接。

Client 保存自己的 socket、接收缓存、断点、DemoRuntime 和 running/mode/startDepth。初始化连接、LSP 连接和调试连接不会共享半包或状态；同类请求顺序读取、同步回复，兼容客户端 FIFO。

## 关键路由

- RequestBreakFilters：回 count=0，满足 DAP initialize，即使没有异常过滤器也必须回复。
- RequestDebugDatabase：设置 version=1、最小 native API JSON、Finished，以及空资产同步。
- StartDebugging：重置该会话、回 DebugServerVersion=1、发送 entry 停止事件。
- SetBreakpoint：校正可执行行，回传客户端原始 filename 和 id，避免 TS 断点 Map 匹配失败。
- RequestCallStack：当前帧及可选 Main 父帧，附绝对源码路径/一基行号/moduleName。
- RequestVariables/RequestEvaluate：调用 Runtime 查询，编码 name/value/type/hasMembers。
- StopDebugging：只停止该模拟会话；Disconnect 只关客户端；服务继续监听。
- 不认识的消息记录并忽略；不伪造引擎资产编辑等成功响应。

## 单步策略

resume 记录原始栈深度，发 HasContinued；每 tick 执行一条指令：

- Into：执行一条后停。
- Over：到深度 ≤ 初始深度时停。
- Out：到深度 < 初始深度时停。
- Continue：直到命中断点或收到 Pause。

内部源码断点优先于单步目标；恢复时跳过当前断点一次，避免立刻停在原行而没有进度。tick 间隔不是调试协议要求，仅为人工观察放慢模拟器。

`sendStopped` 只改 running 状态并发消息，**不调用 DebugBreak、不阻塞网络**。在 VS 给此函数设原生断点可观察封包，但被 VS 挂起时所有客户端都要等待，继续 VS 后才有回复。

## 生产化边界

这是小型教学消息泵，不是高吞吐异步服务器。真实 VM 运行线程、非阻塞发送队列、取消/超时、认证、多调试者所有权、配置完成时序都需单独设计。当前协议无请求 ID，增加异步执行时必须维护回复顺序或协商新版本。
