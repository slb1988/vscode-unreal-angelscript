# debugAdapter.ts：适配器入口

源码：[extension/src/debugAdapter.ts](../../extension/src/debugAdapter.ts)。

唯一逻辑：导入 `ASDebugSession`，调用 `ASDebugSession.run(ASDebugSession)`，让 `vscode-debugadapter` 接管 DAP 输入/输出或 server 模式。

## 与正常启动路径的区别

正常 VS Code 调试配置由 `extension.ts` 的 `ASConfigurationProvider` 建立 TCP listener，直接实例化 session，并设置 `config.debugServer`。因此普通 F5 不依赖此入口单独启动进程。

`extension/esbuild.js` 仍将本文件 bundle 为 `extension/dist/debugAdapter.js`，作为另一入口。根清单 debugger program 指向旧 `extension/out/debugAdapter.js`；如要使用外部程序启动路径，先协调清单、产物路径和运行环境。

## 扩展边界

- DAP 方法放 `debug.ts`，Unreal 消息放 `unreal-debugclient.ts`；不要把业务逻辑塞进入口。
- `debug.ts` 导入 `vscode` 并读取 workspace/settings，不能假设 bundle 可在普通 Node 中脱离扩展宿主直接运行。
- 独立化适配器前，先将 workspace roots、设置等宿主依赖通过参数注入，再测试 stdin/stdout 与 server 两种路径。

参见 [调试会话](debug.md)、[开发运行中的旧配置说明](../development.md)。
