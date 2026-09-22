# 仓库开发与 AI 协作指南

> 按需求保留文件名 `AGETNS.md`；标准工具入口 [AGENTS.md](AGENTS.md) 指向本文。文档使用中文，源码标识符保持原样。

## 1. 这个仓库负责什么

这是 UnrealEngine-Angelscript 方言的 VS Code 扩展，不是 AngelScript 编译器，也不包含 Unreal 端 debug server 的 C++ 实现。

- `extension/`：VS Code 激活、LanguageClient、命令/API 面板、DAP 调试适配器。
- `language-server/`：LSP 服务、容错语法解析、类型数据库、补全/导航/诊断等。
- `language-server/pegjs/angelscript.pegjs`：语法源文件。
- `language-server/pegjs/angelscript.js`：已提交的 Peggy 生成文件；不要手改。
- `package.json`：扩展清单、设置、语言/调试器注册、构建脚本。两个子目录各自安装依赖，不是 npm workspaces。
- `examples/cpp-debug-server/`：独立 C++17/CMake 教学服务，模拟脚本运行并兼容现有协议；不是 Unreal 实现或通用 AngelScript VM。

完整索引：[docs/README.md](docs/README.md)。先读 [架构](docs/architecture.md) 和 [开发运行](docs/development.md)。

## 2. 必须理解的边界

```text
VS Code ──LSP / IPC── language-server ──自定义 TCP── Unreal
VS Code ──DAP─────── ASDebugSession  ──自定义 TCP── Unreal
```

这两条 Unreal 连接独立建立；F5 不是代码补全的前提。默认 Unreal 端口为 `27099`，LSP 的 Node 调试端口 `6009` 与它无关。打开游戏项目的 `Script` 目录，不要把插件仓库当脚本工作区。

编辑器端识别新语法，不等于 Unreal 编译器能编译/执行它。涉及新语义、原生 API 或协议时，需要协调 Unreal 端实现。

## 3. 按任务定位

| 要做什么                                | 首选文档                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 新 keyword、宏说明符                    | [keyword 扩展](docs/guides/keywords.md)、[specifiers](docs/language-server/specifiers.md)                                              |
| 自定义语句、表达式、声明                | [自定义语法](docs/guides/custom-syntax.md)、[grammar](docs/language-server/grammar.md)、[as_parser](docs/language-server/as_parser.md) |
| 成员/参数/上下文补全                    | [补全扩展](docs/guides/completion.md)、[parsed_completion](docs/language-server/parsed_completion.md)                                  |
| 新原生类型、模板、生成 API              | [database](docs/language-server/database.md)、[generated_code](docs/language-server/generated_code.md)                                 |
| 与 debug server 通信                    | [协议与联调](docs/guides/debug-server.md)、[debug](docs/extension/debug.md)                                                            |
| 用 VS 调试 C++ server、VS Code 调试脚本 | [双 IDE 接入指南](docs/guides/cpp-debug-server.md)、[可运行示例](examples/cpp-debug-server/README.md)                                  |
| 新 LSP 能力/设置                        | [server](docs/language-server/server.md)、[extension](docs/extension/extension.md)                                                     |
| 报错与修复动作                          | [ls_diagnostics](docs/language-server/ls_diagnostics.md)、[code_actions](docs/language-server/code_actions.md)                         |
| 格式化                                  | [as_formatter](docs/language-server/as_formatter.md)：当前是未接入 LSP 的独立原型                                                      |

## 4. 修改约定

1. 开始前检查 `git status --short`，保留已有修改及未跟踪文件。本轮分析时已有格式化器、测试和规则文档；不要覆盖或当成已发布功能。
2. 优先修改单一职责模块；`server.ts` 做协议注册和生命周期编排，不堆积具体补全/语义规则。
3. 不只改 TextMate 正则就宣称支持语法。逐项检查 PEG、AST、作用域、类型推导、符号采集、补全、导航/提示的消费者。
4. `ASKeywords` 用于输入中关键字前缀的容错判断，不是补全列表。补全入口是 `parsed_completion.Complete`。
5. AST 的 `start/end` 相对语句；`ASStatement.start_offset` 相对文件；LSP 行列从 0 开始。调试端以 1 基行为默认，避免直接混用。
6. 数据库修改使用 `addSymbol`、`AddTypeToDatabase` 等入口，维护模块归属、位置、依赖与缓存失效；不要绕开索引直接改 Map。
7. 新 AST 节点优先追加到 `grammar/node_types.js`，不要随意重排既有值；修改语法后重新生成 JS，并检查生成差异。
8. 自定义 TCP 的两个 `MessageType` 枚举是重复维护的。不得插入旧编号之间；新增消息要核对 Unreal 端与两个客户端的编号/版本/字节布局。
9. 新设置同步维护根 `package.json`、配置消费处、默认值、刷新策略和中文文档。
10. 不手改 `dist/`、`out/`、`node_modules/`。不因写文档顺便升级依赖或修复运行时代码。

## 5. 构建与验证

在仓库根目录，依赖已安装时执行：

```sh
npm run compile
```

修改 PEG 时还要执行：

```sh
npm run pegjs:compile
```

后者要求 PATH 中有兼容的 `peggy`；生成文件头记录的是 **5.1.0**，仓库没有声明此开发依赖。安装、watch、VSIX 和调试注意事项见 [开发运行](docs/development.md)。

- esbuild 成功不代表 TypeScript 类型检查通过，也不代表 Unreal 集成通过。
- 当前没有根级 `npm test`；不要虚构测试套件。按 [验证清单](docs/testing.md) 做语法 smoke test 和 VS Code/Unreal 联调。
- 新语法必须覆盖半成品输入，例如 `Actor.`、`Math::`、未完成实参和缺失分号，而不只测完整程序。
- 收尾报告写清实际执行的验证、没测的项目、需要 Unreal 配合的变化。

## 6. 文档维护

插件源码模块的说明位于 `docs/extension/` 或 `docs/language-server/`，以源码文件名为主；独立示例的模块说明放在其 `docs/` 子目录。跨模块操作步骤放 `docs/guides/`，不要把整套实现复制到多个文档。新增模块时更新 [总索引](docs/README.md)。所有示例区分“当前行为”和“扩展示意”，不把建议写成已实现能力。

模块文档与扩展教程入口：[docs/README.md](docs/README.md)。
