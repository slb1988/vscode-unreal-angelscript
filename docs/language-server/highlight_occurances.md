# highlight_occurances.ts：文档内读写高亮

源码：[language-server/src/highlight_occurances.ts](../../language-server/src/highlight_occurances.ts)。文件和函数名沿用仓库原有 `occurances` 拼写。

## 流程

`HighlightOccurances(uri, position)` 加载/解析/resolve 当前模块，取 `getSymbolAtOrBefore`，遍历本文件 semanticSymbols，匹配类别、container_type 与 symbol_name。

局部变量和参数再限制声明作用域范围；UnknownError 不高亮。`isWriteAccess=true` 输出 `DocumentHighlightKind.Write`，否则 Read。

这和 semantic tokens 不同：它表示当前选中符号的所有使用位置，不决定普通代码颜色，也不跨文件查引用。

## 扩展

- 新赋值/自增/引用参数语义需要 parser 正确维护读写标记。
- 新符号类别若有特殊作用域或别名匹配，应在此明确增加，而不是假设 FindReferences 的全部逻辑会自动复用。
- 给新增语法生成正确 semanticSymbols 往往比改本模块更关键。

验证声明、读、写、复合赋值、同名局部遮蔽与光标位于名字末尾。相关：[references](references.md)、[语义着色](semantic_highlighting.md)。
