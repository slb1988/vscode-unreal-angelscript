# C++ debug server：Visual Studio + VS Code 最小联调示例

**Visual Studio 调试 C++ 服务进程；VS Code 使用本仓库的 AngelScript 插件调试模拟脚本。** 不需要 Unreal，不需要另写 VS Code 扩展，也不要将 VS Code 的 `debugServer` 配成 C++ 服务端口。

先理解接入关系：[插件如何结合 VS Code、两个 IDE 如何配合](../../docs/guides/cpp-debug-server.md)。

## 1. 示例实现了什么

- 监听 **127.0.0.1:27100**，兼容本仓库的 Unreal 自定义二进制协议，而非直接实现 DAP。
- 同时接受 LSP、DAP 初始化临时连接、DAP 正式连接；断开单个客户端不退出服务。
- 入口暂停、源码断点及行号校正、继续/暂停、F10/F11/Shift+F11。
- Main → Add → Main 的两层栈、局部变量、Watch/hover、可展开的 `Demo::State`。
- 最小 DebugDatabase，让语言服务补全 `Demo::Print`、`Demo::State.LastResult` 等。

**它不是 AngelScript 解释器。** `DemoRuntime` 用 7 条固定指令模拟 [Demo.as](Script/Demo.as)；只从文件读取 `// @demo:...` 标记的位置。改变脚本逻辑不会改变 C++ 的执行逻辑；编辑行号后也应重启服务以重载 source map。

## 2. 用 Visual Studio 2022 构建并调试 C++

安装 VS 的“使用 C++ 的桌面开发”、Windows SDK、CMake。以下命令从**仓库根目录**运行，可用 PowerShell / Developer Command Prompt：

```sh
cmake -S examples/cpp-debug-server -B examples/cpp-debug-server/out/vs2022 -G "Visual Studio 17 2022" -A x64
cmake --build examples/cpp-debug-server/out/vs2022 --config Debug
cmake --open examples/cpp-debug-server/out/vs2022
```

1. VS 打开生成的 `AngelScriptDebugServerDemo.sln`，选择 **Debug / x64**。
2. 启动项目应为 `as-debug-server`；若不是，右键该项目 → 设为启动项目。
3. 按 **Visual Studio 的 F5**，启动 C++ 程序。CMake 已设置默认调试参数 `--port 27100`，源码路径通过编译定义传入，不依赖当前工作目录。
4. 控制台看到 `LISTENING 127.0.0.1:27100` 后，保持运行。第一次走通时先不要设原生断点，以免挡住握手。

不使用 VS 时也可直接运行：

```sh
examples/cpp-debug-server/out/vs2022/Debug/as-debug-server.exe --port 27100
```

可选参数：`--tick-ms 300` 调整连续运行速度；`--script <path/Demo.as>` 换源映射文件；`--port 0` 为测试分配临时端口。默认仅回环监听，不应暴露到公网。建议使用 ASCII 仓库路径，现有 TS 客户端字符串写入不完整支持 Unicode。

## 3. 启动插件，再打开 Script 工作区

### 已安装匹配版本插件

在 VS Code 中直接打开 **[Script](Script)** 目录，不能打开示例父目录代替它。已有 `.vscode/launch.json` 和 `.vscode/settings.json`，DAP 和 LSP 都使用 27100。

### 使用本仓库开发版本（推荐）

在仓库根目录：

```sh
npm ci --prefix extension
npm ci --prefix language-server
npm run compile
```

1. 第一个 VS Code 窗口打开插件仓库，运行 **Launch Client**（见根 `.vscode/launch.json`）。
2. 在新的 **Extension Development Host** 窗口打开 `examples/cpp-debug-server/Script`。
3. 打开 `Demo.as`；避免开发版与正式版扩展重复激活。
4. 在该新窗口按 F5，选择 **AngelScript Demo: connect to C++ server**。

这里有三个不同的 F5：VS 启动 C++；第一个 VS Code 启动扩展宿主；扩展宿主中的 F5 才是脚本调试。

## 4. 按这个顺序验证 VS Code 调试

先在 `Counter = Add(Counter, 2); // @demo:call` 这一行设置断点（当前文件第 13 行，标记为准）。

| 操作 | VS Code 中应看到什么 |
| --- | --- |
| F5 启动脚本调试 | 停在 `@demo:init`；尚未执行声明，Variables 中没有 Counter |
| 再按 F5 继续 | 命中 `@demo:call`；Counter=1 |
| F11 Step Into | 进入 Add，栈为 Add / Main；A=1、B=2 |
| F10 Step Over | 到 `@demo:return`；Result=3 |
| Shift+F11 Step Out | 回 Main 的 `@demo:store`；Counter=3 |
| F10 | 完成写入，`Demo::State.LastResult`=3 |
| 再继续 | while 循环下一次命中调用断点；Counter=4 |
| 在调用行 F10 | 没有函数内断点时，跳过 Add，回到 store；Counter=6 |

Watch 可添加：

```text
Counter
Demo::State
Demo::State.LastResult
Demo::State.ExecutedInstructions
```

在 Add 栈帧里查看 A/B/Result；切换 Main 栈帧再看 Counter。Globals 中的 Demo::State 和 Watch 的 Demo::State 均可展开。this 为空，因为示例全是全局函数。

移除断点后 F5 连续运行，再点暂停按钮；每条模拟指令默认间隔约 300ms。Main 是无限循环，所以从 Main Step Out 不会自然返回，需暂停或命中其他断点。

**VS Code Debug Console 的表达式会走 RequestEvaluate；不是在 C++ 进程里执行任意 C++/AngelScript。** 本例只识别上述变量/成员路径，`Counter + 1`、函数调用等显示 unsupported。Demo::Print 的输出在 **C++ 服务控制台**，不在 VS Code Debug Console。

## 5. 在 VS 中观察对应 C++ 代码

走通一次后，选择性地添加以下原生断点：

- [main.cpp](src/main.cpp) 的 `handleMessage` → `SetBreakpoint` 分支：观察 filename / requestedLine / id / module。
- `RequestVariables` / `RequestEvaluate` 分支：VS Code 展开变量或 Watch 更新时命中。
- `tickRuntime` / `sendStopped`：观察运行状态与向 VS Code 发出的 stopped 消息。
- [demo_runtime.h](src/demo_runtime.h) 的 `DemoRuntime::executeInstruction`：观察 pc、counter、result 改变。

**VS 停在原生断点时，C++ 网络循环也停了；VS Code 可能一直等待回复。这是正常的双层暂停，不是还要在 VS Code 再按一次单步。先在 VS 按 F5 继续，让 TCP 回复送达。**

停止时建议先在 VS Code Shift+F5 断开脚本调试，再在 VS Shift+F5 停 C++。只停 VS Code 不会退出 C++ server。

## 6. 验证命令

```sh
# 原生构建 + 无 npm 依赖的 TCP 测试
cmake --build examples/cpp-debug-server/out/vs2022 --config Debug
ctest --test-dir examples/cpp-debug-server/out/vs2022 -C Debug --output-on-failure

# 已安装 extension 依赖后：真实 ASDebugSession 的 DAP 测试
node examples/cpp-debug-server/tests/dap-smoke.mjs examples/cpp-debug-server/out/vs2022/Debug/as-debug-server.exe

# 已安装 language-server 依赖后：真实解析/补全模块测试
node examples/cpp-debug-server/tests/language-smoke.mjs
```

测试使用临时端口并清理子进程，不抢占你的 27100。DAP 测试仅 stub VS Code 的 workspace API，协议转换使用真实 `extension/src/debug.ts`；它不是 VS Code GUI 自动化。语言测试直接使用真实 parser/database/completion/signature，并不启动 LSP IPC。

本次在 Windows 上使用 **MSVC 19.44 / VS 2022 Debug x64** 编译验证；插件 esbuild 构建、TCP、DAP、语言模块检查通过。**未实际操作 VS/VS Code 图形界面进行联合调试。**

## 7. 文件与边界

| 文件 | 说明 |
| --- | --- |
| `src/protocol.h` | [协议字段与帧格式](docs/protocol.md) |
| `src/demo_runtime.h` | [模拟执行、源码映射和变量](docs/runtime.md) |
| `src/main.cpp` | [网络循环、调度与消息路由](docs/server.md) |
| `Script/` | VS Code 的脚本工作区与 launch/settings |
| `tests/protocol-smoke.mjs` | TCP/数据库/断点/步进/变量/异常输入测试 |
| `tests/dap-smoke.mjs` | 真实适配器的 initialize → disconnect 链路 |
| `tests/language-smoke.mjs` | 类型数据库和 Demo.as 的语言能力检查 |
| `tests/harness.mjs` | 测试进程启动、消息收集、DAP framing |

不支持：真实脚本编译/热重载、任意表达式、条件断点、数据断点、多线程、真实异常、蓝图/资产编辑。serverVersion=1 特意不提供变量地址，避免假装具备数据断点能力。没有 Unreal PIE，“Resume and Stop PIE”在此仅重置模拟器并停到入口。

迁移到真实运行时：保留协议层，用 AngelScript VM 的行回调、真实栈帧和变量检查替换 DemoRuntime。详见 [运行时模块](docs/runtime.md)。
