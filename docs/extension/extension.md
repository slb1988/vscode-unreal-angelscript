# extension.ts：扩展宿主与 LSP 客户端

源码：[extension/src/extension.ts](../../extension/src/extension.ts)。清单：[package.json](../../package.json)。

## 职责与入口

`activate(context)` 创建 `LanguageClient`，运行 `language-server/dist/server.js`，使用 IPC；开发模式为子进程附加 `--inspect=6009`。document selector 限定 `file` scheme + `angelscript`，监听 `**/*.as` 并同步 `UnrealAngelscript` 设置。

语言分析不要写在此文件，优先增加服务端功能和 LSP handler。

## 命令路径

| 命令/通知 | 行为 |
| --- | --- |
| `angelscript.goToSymbol` | 转 `editor.action.goToImplementation`，服务端可继续请求 Unreal 导航 C++ |
| `angelscript.paren` | 补全函数后按设置插括号；提交字符为 `.` 时补调用并再次触发 suggest |
| `angelscript.saveAndCreateBlueprint` | 当前活动文档 dirty 时保存，约 300ms 后调用 LSP executeCommand |
| `angelscript.saveAndEditAsset` | 同上，最终转 `angelscript.editAsset` |
| `angelscript.debugStopPIE` | 向活动 DAP 会话发 `angelscript/stopPIE` |
| `angelscript/wantSave` 通知 | 延迟约 100ms 执行 `workspace.saveAll()`，不是只保存参数指定的文件 |

保存前置命令实际上使用 active editor，不是直接按传入 URI 寻找文档；修改多文件操作时注意这个边界。

## API 浏览面板

- `ASApiSearchProvider`：webview input → `postMessage` → 更新 tree 的搜索条件。
- `ASApiTreeProvider`：无筛选调用 `angelscript/getAPI`，有筛选调用 `angelscript/getAPISearch`；TreeItem ID 加 `__ns_` / `__fun_` / `__prop_` 前缀。
- `ASApiDetailsProvider`：`angelscript/getAPIDetails` 返回 Markdown，再经 `markdown.api.render` 写入 webview。
- 详情与 tooltip 复用服务端的 `data` 标识数组。

三个请求都有服务端实现。文件中声明的 `getModuleForSymbol`、`provideInlineValues` RequestType 没有实际调用/对应 handler；当前 inline values 走标准 LSP，不能据声明认定私有 API 可用。

## 调试配置与表达式选择

`ASConfigurationProvider.resolveDebugConfiguration` 补全 angelscript launch 配置，建立本地随机端口 `Net.Server`；每个 socket 创建 `ASDebugSession`，设置目标 Unreal 主机/端口，再把本地 listener 端口写入 `config.debugServer`。

`ASEvaluateableExpressionProvider` 在当前行向前/后扫描，选择 hover 求值表达式，处理成员链和部分方括号。它不是 PEG 解析器。新成员访问/索引语法需要同时检查这里，而不是只改 LSP。

## 如何扩展

1. 新 UI 命令在根清单 `contributes.commands`/menus 注册，在 `activate` 实现；返回的 Disposable 纳入 `context.subscriptions`。
2. 新私有请求同时定义客户端 payload 和 `server.ts` handler；不要仅声明 RequestType。
3. 新 API 展示节点要让 tree 的 type/data 处理与 `api_docs.ts` 一致。
4. Webview 展示新内容时审查 HTML 转义、脚本权限与内容安全，不把任意数据当可执行脚本。
5. 测试插件多次启停、配置换端口、API 面板未打开就调用详情等生命周期场景。

相关：[server](../language-server/server.md)、[api_docs](../language-server/api_docs.md)、[debug](debug.md)。
