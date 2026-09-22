# TextMate 高亮与编辑配置

源码：

- [angelscript.tmLanguage.json](../../extension/syntaxes/angelscript.tmLanguage.json)
- [angelscript_snippet.tmLanguage.json](../../extension/syntaxes/angelscript_snippet.tmLanguage.json)
- [language-configuration.json](../../extension/language-configuration.json)
- [根清单](../../package.json)的 languages / grammars / semanticTokenScopes

## 三部分职责

1. 主 grammar：关键字、数字、操作符、宏参数、注释、字符串、`f"..."` 嵌入表达式的词法高亮。
2. snippet grammar：悬浮/签名/API Markdown 中 `angelscript_snippet` 代码块的近似着色，按 A/U/F/E 命名模式推断类型，并 include 主 grammar。它不是“代码补全 snippet 配置”。
3. language configuration：注释快捷键、括号配对、自动闭合、包围选区、Enter 缩进；含 JSONC 注释/尾逗号，不能用严格 JSON.parse 当普通 JSON 验证。

## 主要规则位置

- `keyword.declaration.angelscript`：class、struct、event、namespace 等。
- `keyword.statement.angelscript`：if、return、for、fallthrough 等。
- `keyword.type.angelscript`：const、override、mixin、local 等。
- `meta.unrealmacro.*`：UPROPERTY/UFUNCTION/UCLASS 等及说明符正则。
- `repository`：comments、numbers、strings、operators、macro_parens。
- f-string 单独规则中 include `source.angelscript`，让 `{...}` 内部代码再次着色。

这些规则与 PEG 并非同源生成；例如着色列表中的词并不保证语法/编译器支持。

## 增加 keyword 或符号

- 在合适 scope 的正则增加单词，保留 `\b` 边界；JSON 中反斜杠要双写。
- 新宏的参数颜色放在该宏规则里，避免把普通变量同名标成宏说明符。
- 新字符串前缀或配对符号还应改 `autoClosingPairs` / `surroundingPairs`，必要时调整 `onEnterRules`。
- snippet grammar include 主规则，多数普通关键字不需要重复添加；若类型/成员显示模式变了才改 snippet 自有规则。
- 新**语义类型**则修改 `semantic_highlighting.ts`、LSP legend 与根清单 `semanticTokenScopes`，不是只改本模块。

## 验证

在开发宿主执行 **Developer: Inspect Editor Tokens and Scopes**，分别查看 TextMate scope 和 semantic token。关闭语义高亮再测词法层，避免被另一层颜色覆盖而误判。

覆盖注释/字符串内同名词、标识符前后缀、宏嵌套括号、暗/亮主题、悬浮文档代码块。相关：[keyword 教程](../guides/keywords.md)、[语义高亮](../language-server/semantic_highlighting.md)。
