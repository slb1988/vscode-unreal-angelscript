# Unreal AngelScript VS Code 扩展：中文开发文档

面向后续维护者：解释代码实际如何工作、扩展应该改哪里、怎么验证。目标是 UnrealEngine-Angelscript 方言，不是所有 AngelScript 实现的通用规范。

## 阅读顺序

1. [仓库协作约定](../AGETNS.md)
2. [架构与数据流](architecture.md)
3. [安装、构建与调试插件](development.md)
4. [测试与回归清单](testing.md)
5. 按任务阅读下面的教程与模块说明。

## 扩展教程

| 主题 | 内容 |
| --- | --- |
| [新增 keyword / 宏说明符](guides/keywords.md) | 区分着色、保留字、语义和补全；逐项修改清单 |
| [支持项目自定义语法](guides/custom-syntax.md) | 新语句示例、AST/作用域/语义联动、输入容错 |
| [实现与扩展代码提示](guides/completion.md) | 从光标到类型、候选、排序、resolve、签名帮助 |
| [与 Unreal debug server 交互](guides/debug-server.md) | 两条连接、消息编号、双向帧格式、版本、联调 |
| [C++ server 与 VS / VS Code 配合](guides/cpp-debug-server.md) | 可运行示例、扩展挂接、两个调试器、断点/变量/单步流程 |

## 可运行示例

[examples/cpp-debug-server](../examples/cpp-debug-server/README.md)：C++17 + CMake，可用 Visual Studio 2022 调试服务本身，再用本插件在 VS Code 中调试模拟的 `Demo.as`。包含脚本工作区配置、最小类型数据库、TCP/DAP/语言模块测试；不依赖 Unreal，不是 AngelScript 解释器。

## VS Code 客户端模块

| 源文件（`extension/` 下） | 独立文档 |
| --- | --- |
| `src/extension.ts` | [激活、LSP 客户端、命令与 API 面板](extension/extension.md) |
| `src/debug.ts` | [DAP 会话、断点、栈、变量与求值](extension/debug.md) |
| `src/unreal-debugclient.ts` | [调试 TCP 客户端与消息事件](extension/unreal-debugclient.md) |
| `src/debugAdapter.ts` | [调试适配器启动入口](extension/debugAdapter.md) |
| `syntaxes/*.json`、`language-configuration.json` | [TextMate 高亮与语言编辑配置](extension/editor-language.md) |

## Language Server 模块

除语法模块外，下表源码均位于 `language-server/src/`；每个 `.ts` 单独一份说明。

| 源文件 | 独立文档 |
| --- | --- |
| `server.ts` | [LSP 注册、文档生命周期与 Unreal 连接](language-server/server.md) |
| `../pegjs/*`、`../grammar/node_types.js` | [PEG 语法与 AST 契约](language-server/grammar.md) |
| `as_parser.ts` | [模块/作用域、类型提取与语义解析](language-server/as_parser.md) |
| `database.ts` | [类型与符号数据库](language-server/database.md) |
| `generated_code.ts` | [生成 API 的静态建模](language-server/generated_code.md) |
| `parsed_completion.ts` | [上下文补全与签名帮助](language-server/parsed_completion.md) |
| `specifiers.ts` | [Unreal 宏说明符字典](language-server/specifiers.md) |
| `symbols.ts` | [定义跳转、悬浮、大纲与工作区符号](language-server/symbols.md) |
| `references.ts` | [引用查找与重命名](language-server/references.md) |
| `highlight_occurances.ts` | [当前文档读写引用高亮](language-server/highlight_occurances.md) |
| `semantic_highlighting.ts` | [语义着色](language-server/semantic_highlighting.md) |
| `ls_diagnostics.ts` | [编译诊断与本地诊断合并](language-server/ls_diagnostics.md) |
| `code_actions.ts` | [Quick Fix 与代码生成动作](language-server/code_actions.md) |
| `code_lenses.ts` | [模板、蓝图与资产 CodeLens](language-server/code_lenses.md) |
| `assets.ts` | [资产与脚本类映射](language-server/assets.md) |
| `inlay_hints.ts` | [参数名、引用与 auto 类型提示](language-server/inlay_hints.md) |
| `inline_values.ts` | [调试暂停时的行内值描述](language-server/inline_values.md) |
| `color_picker.ts` | [颜色预览与颜色编辑](language-server/color_picker.md) |
| `type_hierarchy.ts` | [类型继承层级](language-server/type_hierarchy.md) |
| `documentation.ts` | [注释到 Markdown 的转换](language-server/documentation.md) |
| `api_docs.ts` | [API 浏览树、搜索与详情数据](language-server/api_docs.md) |
| `unreal-buffers.ts` | [LSP 一侧的 Unreal 消息编解码](language-server/unreal-buffers.md) |
| `debug_parse.ts` | [批量解析排障脚本](language-server/debug_parse.md) |
| `as_formatter.ts` | [独立格式化原型及接入边界](language-server/as_formatter.md) |

## 当前实现与限制

- LSP 和 DAP 都连接 Unreal，但连接、消息处理和用途不同。Unreal 端实现不在此仓库。
- TextMate 着色可独立工作；很多语义请求需等待 `HasTypesFromUnreal()`。不要承诺完整离线补全。
- `server.ts` 注册了 incremental 文档同步；部分旧注释仍写 full，以代码为准。
- 宣告支持 semantic tokens delta，但当前实现返回完整 token 集。
- 格式化器及其现有规则/测试文件在本轮分析开始时为工作区未跟踪内容；未注册格式化 LSP 能力，不能视为发行版功能。
- 初次文档整理的 [PEG / codec 检查记录](testing.md) 与新增 C++ 示例的验证范围分别记录。C++ 示例已用 MSVC 构建，并通过真实 adapter 的 DAP 测试；尚未进行 VS/VS Code GUI 联调或真实 Unreal 联调。

文档中的扩展示例不是已落地的语言功能；具体运行时支持须由所用 UnrealEngine-Angelscript 版本确认。
