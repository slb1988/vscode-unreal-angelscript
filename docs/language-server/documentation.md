# documentation.ts：注释转 Markdown

源码：[language-server/src/documentation.ts](../../language-server/src/documentation.ts)。

## 接口

- `FormatFunctionDocumentation(doc, dbmethod?, activeArg?, italicize=true)`：普通描述、`@param`、`@return`、`@note`、`@see`；可加粗当前活动参数。
- `FormatPropertyDocumentation(doc, italicize=true)`：普通描述、note/see。

供 completion resolve、signature、hover、API 详情复用。本模块只转换文档文本；签名代码块通常由调用者拼装。剥离注释星号/边界的前序处理在 `database.FormatDocumentationComment`，声明注释提取在 PEG。

## 示例

```text
计算插值。
@param Alpha 插值权重
@return 结果
@note Alpha 应位于 0 到 1 之间
```

渲染为描述、参数列表、返回值与备注。参数匹配依赖 DBMethod.args 中的名字。

## 扩展

新增注释 tag 在两种格式化器及其消费者中明确展示效果；避免补全、hover、API 面板三套独立解析规则。

当前 `@param` 正则是 `[A-Za-z0-9]+`，含下划线/其他字符的参数名需扩展后测试。虽然 dbmethod 参数声明可选，命中 param 分支时会访问 `dbmethod.args`，调用者不能无条件省略。

测试空文档、多行描述、Markdown 字符、活动参数、未知 tag 和渲染安全；这不是完整 Doxygen/Javadoc 解析器。
