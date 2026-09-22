# 如何支持项目自定义语法

## 1. 先区分编辑器与运行时

本仓库只实现编辑体验和调试适配；没有脚本编译器。以下 `trace Expression;` 为**新增语法设计示例，当前未实现**。只有引擎也支持相同语法/语义，它才可保存后编译执行。

若只是补充项目自带函数、宏 metadata 或生成 API，优先使用 DebugDatabase、[specifiers](../language-server/specifiers.md)、[projectCodeGeneration](../language-server/generated_code.md)，不必发明新语法。

## 2. 明确语法契约

示例约定：trace 仅可用于函数/代码体，读取表达式但不产生值，不声明变量，不引入新作用域；编辑中允许裸 `trace`、`trace Actor.`。所有扩展示例必须先明确类似条件。

实际模块分析是：

```text
整文件 → 自定义扫描器拆语句/作用域 → PEG AST
       → 声明提取 → 类型后处理 → 表达式类型/语义符号
       → completion、references、hover、hints ...
```

`ParseScopeIntoStatements` 会去掉分号/分离大括号体，PEG 规则不要重复把整份文件当输入。

## 3. 第一步：节点与语法

### 追加节点类型

在 `language-server/grammar/node_types.js` 的导出对象末尾追加（不要重排旧条目）：

```js
TraceStatement: indexed ? i++ : "TraceStatement",
```

### 添加 PEG 规则

在 `statement` 的通用表达式/变量 fallback 之前放入 `trace_statement`；在 keyword 的 `&"t"` 分组追加 `"trace"`，保留 identifier 排除逻辑。

```pegjs
trace_statement
    = &"t" "trace" !identifier_char _ value:optional_expression
    {
        return Compound(range(), n.TraceStatement, value ? [value] : []);
    }
```

`!identifier_char` 防止把 traceValue 拆开。可空 expression 是编辑容错，不是对引擎合法程序的保证。为复杂语法增加容错时，确保分支消费字符，避免 PEG 零宽循环。

此设计没有新声明/作用域，暂不需要 GenerateTypeInformation 中创建 DB 对象。注意 `start` 也用于 LiteralAsset：若契约禁止在 asset 体内使用 trace，需在语义/诊断阶段检查 scope，单靠这个 PEG 入口无法区分。如果语法改成 `task Name { ... }` 一类新声明，则还需 DetermineScopeType、声明提升、模块归属、预索引和清理逻辑。

## 4. 第二步：语义遍历

在 `as_parser.DetectNodeSymbols` 中，将 TraceStatement 加到与 ReturnStatement 一样“遍历所有 children”的组：

```ts
case node_types.TraceStatement:
{
    for (let child of node.children)
        DetectNodeSymbols(scope, statement, child, parseContext, typedb.DBAllowSymbol.Properties);
}
break;
```

以上是新增分支示意，使用该函数已有的参数/类型导入。不应把 trace 的使用错误标为写访问。

这样 `trace Actor.Location;` 内的 Actor/Location 才进入 semanticSymbols，导航、引用、unused 分析才有共同依据。给 `ASKeywords` 追加 trace，用于输入前缀容错。

trace 是语句，不产生值，所以无需让 `ResolveTypeFromExpression(TraceStatement)` 返回孩子类型。若新增的是 `await Task` 这类**表达式**，则必须明确其结果类型，并更新类型推导；不能为了补全方便就把语句伪装成表达式。

## 5. 第三步：补全上下文

关键字候选放置见 [keyword 教程](keywords.md)。在 `parsed_completion.ExtractPriorExpressionAndSymbol` 增加：

```ts
case scriptfiles.node_types.TraceStatement:
{
    context.isRightExpression = true;
    if (!node.children || !node.children[0])
    {
        context.completingSymbol = "";
        return true;
    }
    return ExtractPriorExpressionAndSymbol(context, node.children[0]);
}
```

目的：`trace ` 后补表达式、`trace Actor.` 后补 Actor 成员，而不是继续补语句关键字。实际效果还需检查 `ExtractExpressionPreceding` 给出的候选：它会截取临时片段，并不总传入完整 TraceStatement。

对新操作符/分隔符尤其要同步：ExtractExpressionPreceding、ScanOffsetStart/EndOfOuterExpression、GetCodeOffsetIgnoreTable。否则完整源码可 parse，用户敲到一半却没有候选。

## 6. 第四步：所有 AST 消费者

| 消费者 | trace 示例 / 更复杂语法需要检查的内容 |
| --- | --- |
| `inlay_hints.GetInlayHintsForNode` | 加入递归 children 的组，让 `trace Foo(123)` 仍有参数名提示 |
| `symbols`、`references`、`highlight_occurances` | trace 本身无需新符号类别，但内部表达式要有完整 semanticSymbols |
| `semantic_highlighting` | 通常不用新 token；内部符号复用原类别 |
| `ls_diagnostics` / `code_actions` | trace 使用是否算读取；如有新错误/修复需要独立规则 |
| `inline_values` | 仅当新语法影响变量/赋值/作用域的展示规则时修改 |
| TextMate / language configuration | 加 keyword；新配对字符/字符串需要更多调整 |
| `as_formatter` 原型 | 若后续接入 formatter，要测试不损坏新语法，不能假定已支持 |

控制流 body 若已被 MoveStatementToSubScope 提升，symbol/hint 遍历应像现有 if/while 那样跳过原 AST 最后一个 child，避免重复计算。

## 7. 类型声明、运算符、字面量的额外修改点

### 新声明

补 `global_declaration`/`class_declaration`、ASScopeType/DetermineScopeType、GenerateTypeInformation、PreParseTypes、DB 声明元数据与 ClearModule 移除逻辑。再检查大纲、workspace symbols、继承、重命名权限。

### 新运算符

明确优先级/结合性（PEG 有序选择），更新 ResolveTypeFromOperator 和 operator 到 opXXX 方法映射；补全扫描器、TextMate、调试 hover 表达式边界也要支持。引擎求值器的表达式语法是另一实现。

### 新字符串/嵌入表达式

更新文件扫描器、PEG literal、类型映射、语义插值扫描、completion ignore table、TextMate 和编辑配对。沿用 f-string 思路时，嵌套表达式的 node 偏移必须修正为对应文件位置，不能重复加两次 statement offset。

## 8. 生成与分层验收

修改语法源后按 [开发文档](../development.md) 使用 Peggy 5.1.0 生成，再构建插件。新增语法后可用以下断言思路（**只有完成上述实现后才应通过**）：

```js
const ast = parser.parse('trace Actor.', { startRule: 'start' });
assert.equal(ast.type, n.TraceStatement);
assert.equal(ast.children[0].type, n.MemberAccess);
assert.equal(ast.children[0].children[1], null);
```

同时测试 `trace`、`trace Value`、`traceValue`、非法全局位置，以及完整函数内的真实分号/大括号拆分。随后断言表达式里的符号范围、读访问、补全 label/resolve、签名帮助、引用/rename。

最后在 VS Code+Unreal 中保存编译、F5 暂停/求值。编辑器支持新语法不自动新增 TCP 消息；仅当调试行为或引擎数据确需扩展时，才修改 [debug server 协议](debug-server.md)。
