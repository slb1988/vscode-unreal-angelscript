# parsed_completion.ts：上下文补全与签名帮助

源码：[language-server/src/parsed_completion.ts](../../language-server/src/parsed_completion.ts)。服务端入口为 `Complete`、`Resolve`、`Signature`。

## 光标到候选

```text
server.onCompletion → GetAndParseModule
  → Complete(module, Position)
    → GenerateCompletionContext(offset - 1)
      ├─ 当前语句/作用域、ignore table
      ├─ ExtractExpressionPreceding → 候选片段 → ParseStatement
      ├─ ExtractPriorExpressionAndSymbol → priorType / completingSymbol
      └─ 外层调用、参数索引、赋值左值 → expectedType
    → 宏/自定义访问说明符/命名新符号的专用分支
    → locals + 当前类 + namespace + mixin + keywords + snippets
    → 类型/权限/依赖过滤、排序、预选
```

不是扫描字符串后简单匹配关键字。半成品表达式需要二次解析和候选截取；新增操作符会同时影响文本扫描与 AST 分支。

## CompletionContext 的关键字段

| 字段 | 意义 |
| --- | --- |
| scope / baseStatement / statement | 真实作用域、原始语句、为补全临时解析的语句 |
| completingSymbol / completingNode | 正在补的名字及节点 |
| priorExpression / priorType | `.` / `::` 前的表达式与解析类型 |
| requiresPriorType / priorTypeWasNamespace | 限制成员访问方式，失败时不能滥发全局候选 |
| isRightExpression / isSubExpression | 赋值/运算符右侧、实参等表达式语境 |
| expectedType / leftType | 期望类型、赋值左值类型，用于排序与预选 |
| isIgnoredCode / isNamingSomethingNew | 注释/字符串抑制、声明名字专用逻辑 |
| subOuterFunctions / subOuterArgumentIndex | 调用重载与参数索引 |

## 候选来源与规则

- `AddCompletionsFromLocalVariables`：沿函数父作用域取局部变量和参数。
- `AddCompletionsFromType`：属性、访问器、方法、类型、namespace，考虑继承、编辑区域和 expectedType。
- `AddMixinCompletions`：将匹配接收类型的全局 mixin 暴露为成员形式。
- `AddCompletionsFromKeywords`：依函数/类/循环/switch/表达式等上下文决定候选，不取自 ASKeywords。
- `AddCompletionsFromUnrealMacro`：宏字典及 Attach 的组件名等特殊候选。
- `AddCompletionsFromCallSignature`：命名实参及部分 delegate 相关候选。
- override、Super 调用、Math namespace shortcut 为单独逻辑。

`Sort` 字符串定义候选优先级；`DeterminePreSelectedCompletion` 只在足够明确时预选，保留 VS Code MRU/模糊匹配空间。`filterText`、显示 label 与实际 insertText 不必相同。

## 延迟 resolve

候选 data 为轻量数组：`type`、`namespace`、`prop/global_prop/enum`、`accessor/global_accessor`、`func/global_func/func_mixin`、`decl_snippet` 等，保存类型或 namespace、符号名及方法 ID。

`Resolve` 根据 data 找回数据库对象，填 Markdown 文档/labelDetails；函数候选还挂 `angelscript.paren` 命令。新增 data 类型必须同步此处，不能只让候选出现在列表。

## SignatureHelp

`Signature` 复用上下文和重载匹配逻辑。`ScoreMethodOverload` / `SortMethodsBasedOnArgumentTypes` 考虑实参类型、命名参数、mixin 隐式首参等；documentation 模块负责参数文档。新调用语法要验证活动参数和参数 hint，不只测 completion。

## 设置与附带行为

- `mathCompletionShortcuts`、`correctFloatLiteralsWhenExpectingDoublePrecision`。
- `dependencyRestrictions` 经 `RefreshDependencyRestrictions` 变正则；`.` 转字面点、`$` 匹配一个模块路径段，不是文件 glob。
- `HandleFloatLiteralHelper` 在预期 double 的场景返回 WorkspaceEdit，由 server 实际应用；这不是单纯候选展示。

配置热刷新时 `UnisolateRegexes` 没有与 IsolateRegexes 一起清空，重复更新值得回归；不要把补全依赖过滤当成编译器安全边界。

## 扩展与排错

按 [补全教程](../guides/completion.md) 从 context → priorType → 数据库 → filter → item → resolve 分层检查。若 `Actor.` 空候选，先查 Actor 的类型，而不是把更多词硬加进 keywords。
