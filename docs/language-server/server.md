# server.ts：LSP 服务与生命周期编排

源码：[language-server/src/server.ts](../../language-server/src/server.ts)。这是服务入口，会建立 Unreal 连接并 `connection.listen()`，不适合直接作为纯函数单测依赖。

## 初始化与文件模型

- `process.send` 存在时使用 IPC，否则 stdio。
- 根目录来源：workspaceFolders，或 rootPath/rootUri；可用初始化选项 `additionalScriptRootFolders: WorkspaceFolder[]` 补充脚本根。当前 VS Code 客户端未主动设置这个选项。
- 扫描 `RootPath/**/*.as`，忽略 `settings?.scriptIgnorePatterns || []`；初始化时配置尚未到达则不会使用完整默认设置。修改忽略项也没有在此触发重新扫描。
- 模块名由根相对路径去 `.as`、`/` 变 `.`；假设不同根下的相对模块名全局唯一。
- 同时扫描各根 `.vscode/templates/*.as.template`，交给 `code_lenses.ts`。

文档同步为 `TextDocumentSyncKind.Incremental`。onOpen 使用编辑器内容，onChange 更新 TextDocument，onClose 只标记 isOpened=false。文件 watcher 对未打开文档读磁盘，避免覆盖编辑器未保存内容。

## 解析调度

`TickQueues` 分批推进 Load → Parse → PostProcessTypes → Resolve。`CanResolveModules()` 为 `HasTypesFromUnreal() && LoadQueue.length == 0`。`GetAndParseModule` 为 LSP 请求补齐当前模块加载、解析、类型后处理和 resolve。

编辑通过 `TriggerThrottledModuleParse` 约 100ms 节流；必要时延后再次处理。类型更新调用 `ReResolveAllModules`；诊断配置变化调用 `DirtyAllDiagnostics`。

`DetectUnrealConnectionTimeout` 20 秒后只设置标志，**没有解除 CanResolveModules 门槛**。semantic tokens、inlay hints 和 API 请求中的等待 timer 虽递减 triesLeft，却没有终止判断；不要将其描述为已有 5 秒超时降级。

## LSP 分发

| 请求/能力 | 处理模块 |
| --- | --- |
| completion / completion resolve / signatureHelp | `parsed_completion.ts` |
| definition / implementation / hover / documentSymbol / workspaceSymbol | `symbols.ts` |
| references / prepareRename / rename | `references.ts`，generator + timer 分批推进 |
| documentHighlight | `highlight_occurances.ts` |
| codeLens / executeCommand | `code_lenses.ts`、资产消息 |
| codeAction / resolve | `code_actions.ts` |
| semanticTokens full/delta | `semantic_highlighting.ts` |
| inlayHint / inlineValue | `inlay_hints.ts` / `inline_values.ts` |
| documentColor / colorPresentation | `color_picker.ts` |
| typeHierarchy | `type_hierarchy.ts` |
| `angelscript/getAPI`、`getAPISearch`、`getAPIDetails` | `api_docs.ts` |

completion 触发字符为 `.`、`:`；signature 为 `(`、`)`、`,`，`=` retrigger。不同 handler 的 resolved 前置条件不完全相同，新增功能应显式检查，不要复制旧注释。

## Unreal 连接

固定 host `127.0.0.1`，默认 27099；配置端口变化重连。成功连接约 1 秒后 RequestDebugDatabase，error/close 约 5 秒重试。

- Diagnostics → `UpdateCompileDiagnostics` → LSP publishDiagnostics。
- DebugDatabase → `AddTypesFromUnreal(JSON)`；Finished 或收到数据后 1 秒无新块 → 完成类型导入、添加 primitive、重新 resolve。
- DebugDatabaseSettings → ASSettings 与创建蓝图能力。
- AssetDatabase* → `assets.ts`。
- ReplaceAssetDefinition → WorkspaceEdit 修改字面量资产体，再发 `angelscript/wantSave`；客户端会 saveAll。

执行命令 openAssets / editAsset / createBlueprint 与 implementation 的 C++ 跳转经 [unreal-buffers](unreal-buffers.md) 编码。完整 payload 见 [协议指南](../guides/debug-server.md)。

## 扩展方法

1. 把业务计算放独立模块；此处注册 capability 与 handler，按需取得 module。
2. 设置需同时更新根清单与 `onDidChangeConfiguration`；明确变更后是重解析、重 resolve、刷新 UI，还是只影响下次请求。
3. 新异步请求考虑取消、超时、文件版本变化与断线；不要照搬没有停止条件的 polling。
4. 避免大工作区一次同步遍历阻塞事件循环；沿用分批调度。
5. 当前没有 documentFormattingProvider / formatting handler；接入格式化需显式增加，不能仅加入一个源码文件。
