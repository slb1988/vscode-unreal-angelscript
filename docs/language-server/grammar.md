# PEG 语法与 AST 契约

源码：[angelscript.pegjs](../../language-server/pegjs/angelscript.pegjs)、[生成 JS](../../language-server/pegjs/angelscript.js)、[node_types.js](../../language-server/grammar/node_types.js)。

## 不是整文件编译器

`as_parser.ParseScopeIntoStatements` 先按括号/分号拆文件，PEG 再解析单条语句或声明头。大括号体由 `ASScope` 表示，不全在 PEG AST.children 中。给 parser.parse 整个类文件通常不是正确测试方式。

| startRule | 对应作用域 |
| --- | --- |
| `start_global` | Global / Namespace |
| `start_class` | Class（含 struct 的成员） |
| `start_enum` | Enum 值列表 |
| `start` | Function / Code / LiteralAsset |

`ParseStatement` 还传 `precedesBlock`、`endsWithSemicolon`，帮助区分函数声明和构造式变量声明、完整/不完整参数；`inAsyncFunction` 用于 contextual await，且参与语句缓存匹配。

## AST 数据

- `Literal(range, type, value)`：常量/类型名等。
- `Identifier(range, value)`：标识符。
- `Compound(range, type, children)`：复合节点；children 允许 null。
- operator 节点还携带 `operator`；声明可能使用 `name`、`typename`、`expression`、`parameters`、`macro` 等字段，不能只遍历 children。
- `range()` 提供相对**当前解析字符串**的 start/end。文件偏移应加 `ASStatement.start_offset`。
- `node_types.js` 以 `i++` 分配数字，生成语法在运行时 require 同一表。新增类型建议追加，避免重排扩大兼容风险。

## 主要语法组

| 规则 | 用途 |
| --- | --- |
| `global_declaration` / `class_declaration` / `statement` | 决定语法可出现的位置，PEG 有序选择 |
| `keyword` / `identifier` / `typename_name` | 保留字与词边界；类型名允许范围与普通标识符不同 |
| `expression` / `expr_*` / `call_expression` | 运算符优先级、调用、成员/命名空间/索引 |
| `typename` / `template_typename` | const、引用、模板类型 |
| `function_signature` / `func_qualifiers` | 函数签名、override/final/property 等 |
| `macro_list` / `macro_argument` | Unreal 宏及嵌套 Meta；不依赖 specifiers 字典列举每个合法词 |
| `access_decl` / `access_specifier` | 项目访问控制声明 |
| `asset_decl` | `asset Name of Type` |
| `fstring_literal` | 产生 ConstFormatString，插值表达式后续在 as_parser 中解析 |

`#...` 在此按 comment 跳过，不执行引擎预处理条件；也不应假设高亮了 `import` 就支持非自动导入体系。

## 输入容错

有 incomplete_var_decl、parameter_list_incomplete、可缺失子表达式、末尾 `.`、不完整 `::`/Cast 等处理。PEG 容错的目标是“用户还没输入完也能分析上下文”，不是完整编译合法性检查。

新增规则要放在泛化 identifier/variable fallback 之前，并加词边界，避免吞掉合法的同前缀标识符。新增节点还必须接入 [as_parser](as_parser.md) 和 [parsed_completion](parsed_completion.md) 的显式 switch。

## async / await

支持 `async FTask RunAsync(UPLAutomationAsyncContext T)` 和 `await UISteps::WaitForWidgetActive(...)` 等 MainDev 实际语法。`async` 仅在函数声明前识别，设置 `FunctionDecl.isAsync` / `DBMethod.isAsync`；函数体及嵌套块保留参数、局部变量作用域。`await` 是一元优先级的 `AwaitExpression`，children[0] 为操作数（输入未完成时可缺省），符号与参数提示继续遍历操作数。

两者不是全局保留字；普通函数中的 `int async`、`int await`、`await()` 不受影响。当前运行时支持 void-result FTask/adapter await，类型推导不把 Action/FTask 操作数冒充结果值。此处不新增运行时能力、PLAutomation 入口诊断或模板；不检查 native await adapter 合法性，编译合法性仍由引擎判断。

补全覆盖 async 声明关键字、async 函数体中的 await、`await T.` / `await UISteps::` 及未完成实参；声明进入原有大纲、导航与 hover 路径，TextMate 提供常见声明/await 调用的关键字着色。测试与本地生效步骤见 [测试清单](../testing.md#async--await-编辑体验回归) 和 [开发运行](../development.md#在-vs-code-中运行插件)。

## 生成与验证

按 [开发运行](../development.md) 使用 Peggy 5.1.0 及四个 allowed start rules 重生成；普通 esbuild compile **不会**自动运行 peggy。修改后同时审查 `.pegjs` 与 `.js`。

最小 smoke 示例见 [测试清单](../testing.md)；带新节点的完整路线见 [自定义语法教程](../guides/custom-syntax.md)。
