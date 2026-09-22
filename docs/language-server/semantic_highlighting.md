# semantic_highlighting.ts：语义着色

源码：[language-server/src/semantic_highlighting.ts](../../language-server/src/semantic_highlighting.ts)。

## 数据流

`asmodule.semanticSymbols` → `BuildSymbols` → SemanticTokensBuilder。根据 ASSymbolType 映射到 parameter/local/member/global/function/accessor 等；类型/namespace 还通过 DBTypeClassification 区分 Actor、Component、Struct、Delegate、Event、Primitive。

`symbol.noColor` 会跳过；范围由文件绝对 offset 转 LSP Position，长度为 end-start。新符号范围要保证适合单行 token，不能把整段跨行语句当一个 token。

## Legend 与主题

`SemanticTypeList` 定义索引，server 初始化时给每项加 `as_` 前缀形成 legend。根 `package.json.contributes.semanticTokenScopes` 将 token 映射到 TextMate scope，供主题着色。

新增类别必须联动：

1. 必要时增加 parser 的 ASSymbolType 或数据库分类。
2. `SemanticTypeList` 和 `BuildSymbols`。
3. 根清单 `semanticTokenScopes`，必要时 README 主题示例。

普通 keyword 一般由 TextMate 处理，不必为每个新关键字增加 semantic type。

## 当前 delta 行为

虽然 LSP 宣告 full.delta=true，`HighlightSymbolsDelta` 在生成新 tokens 后立即 `return newTokens`；后面的差异比较不会执行。返回完整 tokens 是当前事实，不是已有增量优化。

若实现真正 delta，缓存要按文档和 resultId 管理；当前单个 `PrevTokens` 不足以作为多文件增量基线。

## 验证

连接 Unreal 后检查类型分类、未知符号、无颜色标志和编辑后偏移；关掉 semantic highlighting 对比 [TextMate](../extension/editor-language.md)。语法正确但颜色丢失时先看 semanticSymbols，而不是直接补主题配置。
