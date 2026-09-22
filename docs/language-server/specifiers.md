# specifiers.ts：Unreal 宏说明符

源码：[language-server/src/specifiers.ts](../../language-server/src/specifiers.ts)。内容主要是“说明符 → 文档”字典，不是语法解析器或引擎支持列表。

## 字典划分

- `ASPropertySpecifiers`：通用 UPROPERTY。
- `ASPropertySpecifiersForActors` / `ForWidgets`：DefaultComponent、Attach、BindWidget 等上下文特有项。
- `ASClassSpecifiers`、`ASStructSpecifiers`、`ASFunctionSpecifiers`。
- `*_HAZE` / `*_NO_HAZE`：由 Unreal 下发的 `useAngelscriptHaze` 选择，不是任意切换即可让引擎支持特性。
- `*SubSpecifiers`：Meta、ReplicationCondition 等嵌套项；**外层 key 要小写**，例如 `meta`，供补全查找。

## 消费链

`parsed_completion.AddCompletionsFromUnrealMacro` 选字典，生成 keyword 候选及文档；`symbols.GetWordHover` 提供词级 hover 回退。

hover 的字典汇总当前没有包含 Actor/Widget 专用表，所以“加进补全表”不一定自动获得同样的 hover。新增专用表时检查两个消费者。

PEG 的 macro_argument 允许通用标识符/值，普通新增说明符通常不需要增加 AST 节点，也不应加入全局保留字 keyword。

## 扩展步骤

1. 确认 Unreal 插件已经实现该 specifier。
2. 选对宏/类型/方言字典，新增简短中文或项目约定文档。
3. 若是 `Meta=(...)`，放到对应 `SubSpecifiers.meta`。
4. 检查 TextMate 宏参数正则的颜色需求。
5. 若新说明符改变补全可见性、类型或函数行为，在 `as_parser.MakeMacroSpecifiers` 的消费链及 DB 模型增加语义，而非只写说明文字。
6. 验证不完整宏输入、已有宏后继续声明、嵌套 Meta、错误上下文不出现候选。

示例与分类决策见 [keyword / 宏扩展教程](../guides/keywords.md)。
