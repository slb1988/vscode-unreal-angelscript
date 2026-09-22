# 如何实现和扩展代码提示

## 1. 选择正确层次

| 目标 | 首选扩展点 |
| --- | --- |
| 新原生函数/类型能补全 | Unreal 导出 DebugDatabase + database 模型 |
| 脚本类有隐式静态/成员函数 | generated_code 或 projectCodeGeneration |
| 新语法后的上下文提示 | parser 类型推导 + parsed_completion 上下文 |
| 固定 keyword / 宏参数 | AddCompletionsFromKeywords / specifiers |
| 参数名灰字 | inlay_hints，不是 CompletionItem |
| 调试变量值 | inline_values + DAP，不是静态补全 |

新增普通 API 时，直接往补全数组塞字符串是最不完整的做法：没有签名、类型、hover、导航等共享信息。

## 2. 用 `Actor.Get...` 跟一遍调用链

1. VS Code 在 `.`/`:` 触发或主动请求 textDocument/completion。
2. server 的 GetAndParseModule 确保模块已解析，并在类型就绪时 resolve。
3. `Complete` 取光标前一个字符，`GenerateCompletionContext` 找原始 statement/scope。
4. `ExtractExpressionPreceding` 从文本中生成候选片段，用 `ParseStatement` 容错解析。
5. `ExtractPriorExpressionAndSymbol` 看见 MemberAccess，设置 completingSymbol=`Get...`，再调用 `ResolveTypeFromExpression(Actor)`。
6. 取得 priorType 后，只搜索该类型/继承/mixin；若 `.` / `::` 访问方式不匹配，不返回无关候选。
7. `AddCompletionsFromType` 结合访问权限、编辑上下文、期望类型等生成 items。
8. VS Code 选中某候选后请求 completionItem/resolve，补文档、签名和括号补全命令。

赋值右值或函数实参的 expectedType 用于排序/预选，不是凭词频推荐。

## 3. 例 A：为原生类型增加方法

假设 Unreal 为 UExample 注册 `ComputeScore(float Scale) const`。

1. 在引擎绑定/导出的 DebugDatabase 中包含方法 name、return、args、const、doc 等，格式见 [database](../language-server/database.md)。
2. 客户端 `DBMethod.fromJSON` 读取；如新增了协议字段，补兼容读取。
3. 检查 `ResolveTypeFromExpression` 能得到 UExample，类型成员索引里有 ComputeScore。
4. 通常不需增加 PEG keyword，也不需在 Complete 里写专用方法分支。
5. 测 `Object.Comp`、`auto Score = Object.ComputeScore(1.0)`、hover、signature、返回值后继续点号访问。

若函数是引擎按脚本类型生成的 API，改 [generated_code](../language-server/generated_code.md)，而不是伪造一份不随模块清理的全局方法。

## 4. 例 B：增加一个 snippet 候选

下面是**扩展示意**：在已经确认“函数体里、非表达式、非成员访问”的分支添加模板。具体引擎须支持 Print 绑定。

```ts
if (context.scope && context.scope.isInFunctionBody()
    && !context.requiresPriorType && !context.isRightExpression
    && !context.isSubExpression && CanCompleteTo(context, "Print"))
{
    completions.push({
        label: "Print(...) 模板",
        filterText: "Print",
        kind: CompletionItemKind.Snippet,
        insertText: 'Print("${1:message}");$0',
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: Sort.Snippet,
        documentation: "插入日志调用模板；运行时依赖项目绑定的 Print。",
    });
}
```

把逻辑放在适合的 Add... 辅助函数，并在 Complete 调用；不要让 snippet 覆盖真正的重载候选。固定文档不必有 data；真实方法候选应沿用 DBMethod 的 data/resolve，而非复制签名字符串。

## 5. CompletionItem 设计

| 字段 | 设计要点 |
| --- | --- |
| label / labelDetails | 展示名称、参数提示/返回类型；不一定等于实际插入文本 |
| insertText / textEdit | 控制插入/替换；显式 edit 范围应为 LSP 零基 Position |
| filterText | 为快捷别名、大小写、显示后缀提供实际筛选词 |
| sortText | 复用 Sort，别让所有新项霸占最高优先级 |
| preselect | 只在单一明确目标时使用，不覆盖用户 MRU |
| commitCharacters | 例如 `.`、`(`、`;`，要检查与括号补全命令的交互 |
| data | JSON 可序列化的轻量身份，不要传 AST/DB 实例 |
| documentation | 固定轻量文档可直接给，昂贵签名延后到 Resolve |

现有函数 data 形如 `["func", typeName, methodName, id]`、全局函数形如 `["global_func", namespace, methodName, id]`。直接复用创建方法候选的代码比手拼更可靠。

## 6. 新语法的上下文提示

修改顺序：

1. PEG 接受完整语句及关键编辑中状态。
2. parser 为表达式给出正确 DBType、为声明提供可查符号。
3. GenerateCompletionContext 能提取片段；ExtractPriorExpressionAndSymbol 知道补哪个孩子。
4. 需要新的分隔符时更新文本扫描和 ignore table。
5. 如果新增触发字符，更新 server completionProvider；普通新 keyword 不需要增加触发字符。
6. 同步 Signature 和 inlay hints 的调用结构/参数索引。

不要把新语法所有字符都当“忽略代码”，也不要在 priorType 为 null 时无条件返回全部全局 API 来掩盖类型推导失败。

## 7. 调试断点与检查项

在 Attach to Server 中依次检查：

```text
server.onCompletion
→ Complete / GenerateCompletionContext
→ ExtractExpressionPreceding / ParseStatement
→ ExtractPriorExpressionAndSymbol
→ ResolveTypeFromExpression / LookupType
→ AddCompletionsFromType / is*AccessibleFromScope
→ Resolve
```

| 现象 | 常见检查点 |
| --- | --- |
| 原生类型全缺 | HasTypesFromUnreal、DebugDatabase 是否完成 |
| 只有新语法后缺 | AST、片段截取、左值类型 |
| DB 有方法但候选没有 | private/protected/access、isCallable、EditOnly/NoEdit、dependencyRestrictions |
| 候选有但文档空 | data 类型、方法 ID、Resolve 与 documentation |
| 补完重复括号 | commitCharacters、angelscript.paren、insertParenthesis 设置 |
| 参数提示错位 | mixin 隐式首参、named argument、重载评分、未完成括号 |

回归同时覆盖全局/类/函数/命名空间、注释/字符串、未保存编辑、跨文件改类型、断线重连。最小 fixture 思路见 [测试清单](../testing.md)。
