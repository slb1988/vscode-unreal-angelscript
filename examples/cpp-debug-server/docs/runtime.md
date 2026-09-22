# demo_runtime.h：模拟脚本运行与检查

源码：[src/demo_runtime.h](../src/demo_runtime.h)。无 socket、无 DAP、无 AngelScript VM，便于在 Visual Studio 中直接观察 C++ 状态。

## 固定执行模型

```text
Init → Call → Add → Return → Store → Increment → Print
         ▲                                      │
         └──────────────────────────────────────┘
```

Call 建立 Add 的参数；Return 把 Result 写回 Counter。Main 无限循环，因此可随时演示暂停，且从 Main StepOut 不会自然结束。

pc 表示**下一条尚未执行的语句**。在 Init 停住时，Counter 的声明还没执行，不应显示为已初始化变量；Add 完成后到 Return 才显示 Result。

`depth()` 在 Add/Return 时返回 2，其余返回 1；网络层利用深度差决定 Into/Over/Out。真实运行时应提供真实调用栈，而不是沿用这七个硬编码状态。

## SourceMap

读取 Demo.as 中的七个 `// @demo:` 标记，生成一基行号；缺失或重复标记启动失败。脚本是可见源码映射，不被解释执行。修改业务语句要同步 C++；只改变文件排版则重启后会重新定位标记。

设置断点时，找到请求行之后最近的可执行行；超出文件可执行范围则返回 -1。moduleName 优先用于匹配源码，供 adapter 从本地 Script 根定位。

## 变量与求值

- `variables("0:%local%")`：当前帧参数/局部变量。
- `variables("1:%local%")`：Add 内暂停时 Main 的 Counter。
- `%module%`：返回可展开的 Demo::State；`%this%` 为空。
- `0:%module%.Demo::State` / `0:Demo::State`：分别来自 Globals 展开和 Watch 展开。
- `evaluate(expression, frame)`：只允许已定义的变量和 Demo::State 成员路径，支持切换帧，不执行函数、算术或系统命令。

变量值来自 C++ 的 counter/a/b/result/lastResult 等字段，所以 VS 原生 Locals 与 VS Code 脚本 Variables 能对应，但两边的“栈”不是同一个调用栈。

## 接真实 VM 时替换哪里

将 executeInstruction 改为 VM 的执行/行回调；SourceMap 改为编译器 source map；depth/variables/evaluate 改为暂停上下文的检查接口。仍要确保暂停 VM 时通信可以继续，且帧/变量句柄在 continue 后不会引用已失效内存。

本例每个正式调试连接持有独立 DemoRuntime，断开后销毁。真实游戏通常是共享进程/VM，需另设计 attach/detach 与所有权，不应把断开调试等同于销毁游戏。
