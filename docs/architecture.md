# 架构与数据流

## 1. 运行边界

```text
VS Code Extension Host
  extension/src/extension.ts
    ├─ LanguageClient ── LSP / Node IPC ──────────────┐
    ├─ 命令、API Tree/Webview                        │
    └─ 本地随机端口 DAP listener                     │
         └─ ASDebugSession                           │
              └─ unreal-debugclient.ts ── TCP ──┐    │
                                                │    ▼
                                                │ language-server/dist/server.js
                                                │   ├─ 文档、解析队列、LSP handlers
                                                │   ├─ parser + typedb + 功能模块
                                                │   └─ unreal-buffers.ts ── TCP ──┐
                                                ▼                               ▼
                                             UnrealEngine-Angelscript debug server
                                             （实现不在此仓库，默认 27099）
```

LSP 也可独立以 stdio 启动；入口根据 `process.send` 是否存在选择 IPC 或 stdio。DAP 则在通常的 VS Code 路径中由扩展进程内的 `ASDebugSession` 服务。`debugAdapter.ts` 是另一启动入口，不能把它误认为正常会话唯一入口。

## 2. 三套协议不是一回事

| 通道 | 内容 | 入口 |
| --- | --- | --- |
| VS Code ↔ LSP | completion、hover、references、diagnostics 等 JSON-RPC 请求/通知 | `extension.ts` ↔ `server.ts` |
| VS Code ↔ DAP | initialize、launch、stackTrace、variables、evaluate 等调试请求/事件 | `debug.ts` |
| 客户端 ↔ Unreal | 类型数据库、编译结果、资产、断点/变量等自定义二进制消息 | 两个 TCP codec |

`6009` 是 Node inspector；`config.debugServer` 是 VS Code 连接本地 DAP 的随机端口；`launch.port`/`unrealConnectionPort` 才是 Unreal 端口。

## 3. 代码分析流水线

```text
扫描 Script/**/*.as / 打开文档 / 增量编辑 / 文件变化
  → ASModule.content + TextDocument
  → ParseScopeIntoStatements（括号/分号扫描，拆作用域与语句）
  → ParseAllStatements → ParseStatement → Peggy AST
  → GenerateTypeInformation（声明、作用域变量、DBType/DBMethod/DBProperty）
  → PostProcessModuleTypes → generated_code（补充隐式 API）
  → ResolveModule
      ├─ ResolveAutos
      ├─ DetectScopeSymbols / DetectNodeSymbols
      └─ 懒加载依赖模块，必要时重新 resolve
  → semanticSymbols / delegateBinds / annotatedFunctionCalls / moduleDependencies
  → 补全、导航、诊断、重命名、语义高亮、提示、颜色等
```

初始后台队列分为 Load / Parse / PostProcessTypes / Resolve，每轮分别最多处理 200 / 10 / 50 / 20 个模块，用 timer 让出事件循环。编辑触发的解析有约 100ms 节流；请求还可通过 `GetAndParseModule` 按需解析。

## 4. 数据来自哪里

- **脚本声明**：本地 `.as`；带 `declaredModule` 和源文件偏移，可以跳转、查引用和重命名。
- **原生类型/API**：Unreal 推送 `DebugDatabase` JSON，进入同一个 `database.ts`。没有脚本声明位置；跳 C++ 需让 Unreal 执行源码导航。
- **隐式/生成 API**：`generated_code.ts` 根据继承、delegate、Haze 标志及项目配置补齐静态模型。不是写出 `.as` 文件，也不会给引擎生成函数。
- **资产关联**：独立的 `assets.ts` 双向索引；用于蓝图/数据资产 CodeLens。

类型数据库就绪与脚本解析是不同条件。`CanResolveModules()` 当前要求 Unreal 类型已完成且 LoadQueue 已清空；不是等固定时长后就自动进入完整离线模式。

## 5. 四种“代码提示”

| 用户所见 | 实现 | 是否读取运行值 |
| --- | --- | --- |
| 输入候选、方法参数弹窗 | `parsed_completion.ts` | 否 |
| 鼠标悬浮文档/类型 | `symbols.ts` + `documentation.ts` | 否 |
| 参数名、auto 类型灰字 | `inlay_hints.ts` | 否 |
| 暂停调试时的变量值 | `inline_values.ts` 提供描述，DAP/Unreal 求值 | 是 |

不要为了增加参数名提示去改 debug server，也不要在 LSP 中缓存调试变量值。

## 6. 高亮与语法的边界

TextMate 正则只负责词法着色；PEG 负责容错 AST；`as_parser.ts` 负责声明、类型与语义符号；语义 token 根据符号再着色。这几层维护不同信息，需要按功能同步，而不是任选其中一层。

例如新语法能着色但不能 `Actor.` 补全，优先看 AST 和 `ResolveTypeFromExpression`，不是继续补 TextMate 正则。

## 7. 定位故障

| 现象 | 优先检查 |
| --- | --- |
| 所有原生 API 都没有 | Unreal 连接、端口、DebugDatabaseFinished、类型就绪 |
| 新语法后面的成员补全消失 | 语句拆分、PEG AST、补全上下文、左侧类型 |
| 补全存在，但不能跳转 | `declaredModule`、offset、semanticSymbols |
| 能解析但重命名漏引用 | `DetectNodeSymbols` 是否访问新节点、依赖候选模块 |
| F5 一直初始化 | BreakFilters 响应；initialize 要等它才返回 |
| 变量显示串位 | Unreal 消息顺序、FIFO 等待队列、协议版本 |

详见 [开发运行](development.md)、[验证](testing.md) 和 [debug server 协议](guides/debug-server.md)。
