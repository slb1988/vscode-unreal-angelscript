# 如何新增 keyword 与宏说明符

## 1. 先判断要加的是什么

“支持一个词”有多个层次，不能把它们混为一谈：

| 需求 | 主要修改 | 是否需要改 PEG |
| --- | --- | --- |
| 普通原生类/函数出现在候选中 | Unreal DebugDatabase、database | 通常不需要 |
| `UPROPERTY(ProjectFlag)` 一类说明符 | specifiers、宏着色，必要时语义消费 | 通常不需要 |
| 现有语法的 keyword 不出候选 | parsed_completion 的上下文列表 | 看语法是否已经支持 |
| 新保留字/语句/操作符 | grammar + parser + completion + TextMate 等 | 需要 |
| 单纯新增代码模板 | CodeLens template 或 completion snippet | 不需要，只要展开后是已有语法 |

增加关键字高亮不等于支持解析；增加补全不等于 Unreal 能编译。先与目标引擎版本确认语法/绑定契约。

## 2. 数据型扩展：宏说明符

假设引擎已经新增 `UPROPERTY(ProjectFlag)`（**扩展示意，当前仓库没有该能力**）。

### 第一步：选字典

在 `language-server/src/specifiers.ts` 对应字典添加：

```ts
// ASPropertySpecifiers 中
"ProjectFlag": "项目自定义属性标记；运行行为由 Unreal 插件实现",
```

若只对 Actor/Widget 有意义，放专用字典，而不是污染所有属性候选。Haze 与非 Haze 的区别跟随 `useAngelscriptHaze`。

嵌套 metadata 示例：

```ts
// ASPropertySubSpecifiers.meta 中
"ProjectCategory": "项目自定义元数据",
```

外层 `meta` 等 key 必须小写，因为补全会把 outerAssignIdentifier 转小写。

### 第二步：补全、Hover 与着色

- `AddCompletionsFromUnrealMacro` 已读取既有字典；新增**字典类别**才需要改分发。
- `symbols.GetWordHover` 汇总通用/Haze/SubSpecifiers 表，但目前不包含 Actor/Widget 专用表；专用说明符要检查这里。
- 在 `angelscript.tmLanguage.json` 对应 `meta.unrealmacro.property` 的 specifier 正则加颜色规则（需要单独高亮时）。
- 通常不改 PEG：`macro_argument` 本来就接收普通标识符/嵌套列表。不要把 ProjectFlag 加入全局 keyword，从而禁止用户用它命名变量。

### 第三步：只在确有语义时扩展模型

如果这个标记影响属性是否可编辑、函数是否可调用或返回类型，继续修改 parser → DBProperty/DBMethod → completion/diagnostics 的消费链。仅加入字典只是提示与文档。

测试 `UPROPERTY(Proj`、`UPROPERTY(Meta=(Proj`、完整宏后接声明，以及普通代码里同名标识符不受影响。

## 3. 语言型扩展：新 keyword

以假设新语句 `trace Value;` 为例。完整 AST 代码见 [自定义语法教程](custom-syntax.md)，这里重点说明各份“关键字列表”的不同用途。

| 文件/入口 | 新增 trace 的职责 |
| --- | --- |
| `.pegjs` 的 `keyword` | 在 identifier/typename_name 里作为保留字排除，带词边界 |
| `.pegjs` 的 `statement` + 新规则 | 让它成为真正语句，而不是只返回 null 的 keyword fallback |
| `as_parser.ASKeywords` | 识别输入中的 `tr`/`tra` 前缀，减少 UnknownError 闪烁 |
| `parsed_completion.AddCompletionsFromKeywords` | 在合法作用域生成 CompletionItem |
| TextMate `keyword.statement.angelscript` | 词法颜色 |
| parser/补全/提示的节点 switch | 识别 trace 内部表达式的语义与编辑上下文 |

`ASKeywords.push("trace")` **不会自动完成其他任何一项**。

### 在正确上下文补全

在 `AddCompletionsFromKeywords` 函数体专用分支中增加：

```ts
// 仅表示放置位置，复用该函数已有 context / completions。
if (context.scope && context.scope.isInFunctionBody()
    && !context.isRightExpression && !context.isSubExpression)
{
    AddCompletionsFromKeywordList(context, ["trace"], completions);
}
```

如果希望插入模板，可生成 `CompletionItemKind.Snippet` + `InsertTextFormat.Snippet`；不要把“裸关键字候选”和“有占位符代码模板”混用。新关键字出现在赋值右侧、成员点号后、注释/字符串内是否合理，必须单独确认。

### 词法规则

在原 statement 正则的单词组追加 `trace`，保留前后 `\\b`（JSON 文本中双反斜杠）。用 Token Inspector 测 `trace`、`traceValue`、注释/字符串中的 trace，不要让前缀误高亮。

普通 keyword 的 hover 并没有现成通用字典；若希望悬浮说明，另设计入口，不要把语言关键字硬塞进 UPROPERTY 字典。

## 4. 修改函数限定符的特殊情况

`func_qualifiers` 本身允许部分普通 identifier 作为 qualifier；但 `GenerateTypeInformation` 只给 const/final/override/property 等设置实际 DB 标记。因此“PEG 接受新限定符”并不表示权限、提示、诊断已经理解它。

新增限定符需明确它是保留字还是上下文词，再补 DBMethod 字段、候选位置和语义消费者。不是所有新增词都应该全局保留。

## 5. 验收清单

- [ ] 引擎真实支持；文档明确最小引擎/协议版本。
- [ ] 完整输入与关键字前缀都工作，不吞同前缀标识符。
- [ ] 作用域正确、注释/字符串不乱出候选。
- [ ] AST、符号采集、类型推导、引用与提示都覆盖需要的行为。
- [ ] 修改 PEG 后生成 JS，再编译；没有只改生成文件。
- [ ] 运行 [语法与集成测试](../testing.md)，更新对应模块说明。
