# symbols.ts：导航、Hover 与符号列表

源码：[language-server/src/symbols.ts](../../language-server/src/symbols.ts)。

## 入口与数据来源

| 函数 | LSP 功能 |
| --- | --- |
| `GetDefinition` / `GetSymbolDefinition` | definition；根据 semantic symbol 找声明 |
| `GetCppSymbol` / `GetUnrealTypeFor` | implementation 的原生符号回退 |
| `GetHover` | 类型、变量、函数、属性、宏说明 |
| `DocumentSymbols` | 当前文档分层大纲 |
| `WorkspaceSymbols` / `ResolveWorkspaceSymbol` | 全工作区符号搜索与延迟补位置 |

声明位置来自 ASModule / DBType / DBMethod / DBProperty，不做全文正则搜索。局部变量向父函数作用域查找，namespace 可对应多个声明，accessor 联合 Get/Set。

## F12 与 Alt+G 的差别

`server.onDefinition` 返回脚本位置；`onImplementation` 先做同样的脚本查找，无结果时调用 `GetCppSymbol`，经 TCP GoToDefinition 请求 Unreal 导航原生源码。

`angelscript.goToSymbol`（Alt+G）实际上调用 VS Code goToImplementation，所以能走这条 C++ 回退。Unreal 的 IDE/source navigation 支持由引擎决定，不能承诺 VS Code 内直接打开所有 C++ 属性。

## Hover

优先取光标下 semantic symbol：类型展示声明，变量展示推断类型，方法展示签名和 `FormatFunctionDocumentation`；重载/由参数决定的返回类型会复用 completion 的帮助函数。

找不到 symbol 才提取当前单词，经 `GetWordHover` 查宏说明符字典。这不是一份通用语言关键字说明库。

输出通常是 `angelscript_snippet` Markdown fence，着色由 [编辑语言模块](../extension/editor-language.md) 的 snippet grammar 负责。

## 扩展检查

新增声明/符号类别时，同时检查：

1. parser 是否建立 semantic symbol 与正确 declaredModule/offset。
2. `GetSymbolDefinition` 是否知道该类别，能处理多声明/生成关联。
3. hover 分发、文档格式与代码块是否正确。
4. DocumentSymbols / WorkspaceSymbols 的 SymbolKind、名称、父子范围和 resolve data。
5. 原生类型无脚本位置时返回空结果或明确回退，而非伪造 Location。

测试同名不同 namespace、Get/Set 属性、重载、auto、模板、局部遮蔽、已删除文件。相关：[references](references.md)、[documentation](documentation.md)。
