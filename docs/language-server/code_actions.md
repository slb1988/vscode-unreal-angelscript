# code_actions.ts：Quick Fix 与重构动作

源码：[language-server/src/code_actions.ts](../../language-server/src/code_actions.ts)。

## 两阶段流程

`GetCodeActions(module, range, diagnostics)` 建立 CodeActionContext，将选择范围扩展到整行，定位 scope/statement/semanticSymbols，再收集候选。

多数候选只包含 title、kind、data（含 uri/type/位置等）；用户选择后，server 重新取得已解析模块并调用 `ResolveCodeAction`，才生成 WorkspaceEdit。少数操作直接携带 command。

## 当前动作类别

| data.type / 功能 | 主要目的 |
| --- | --- |
| `delegateBind` | 根据 delegate 签名生成 UFUNCTION 绑定方法 |
| `methodOverride` | 父方法覆盖实现 |
| `addCast` / `superCall` | 添加 Cast 或 Super 调用 |
| `materializeAuto` | 将 auto 显式化为推导类型 |
| `variablePromotion` | 把变量提升为成员等 |
| `insertMacro` | 添加 Unreal 宏 |
| `insertCases` | 补齐 enum switch case |
| `methodFromUsage` | 根据调用点生成缺失方法 |
| `createActivationParameters` / `createDeactivationParameters` | Haze 特有参数结构生成 |
| Create Blueprint | 通过保存前置命令请求 Unreal 创建资产 |

`GetIndentForStatement`、`GetIndentForBlock`、`ExtendIndent` 与各类插入位置辅助函数用于保持现有缩进。WorkspaceEdit 的 TextEdit 不是 VS Code Snippet，不能把 `$0` 等占位符未经处理塞进去。

## 新动作步骤

1. 增加 `AddXActions(context)`，在 GetCodeActions 中调用，限制合法上下文。
2. 在 data 中保存可序列化、足够重新定位的信息；不要把整个 AST/DB 对象发给客户端。
3. 增加 `ResolveX` 并在 ResolveCodeAction 分发。
4. resolve 时重查模块/类型，使用当时的 offset/range；新增实现应防止候选生成后文本改变导致错位。
5. 与诊断配套时通过 `diagnostic.data.type` 关联，不依赖文案。
6. 外部副作用使用明确 command；纯代码生成返回 edit，让客户端应用与撤销。

## 验证

带宏/注释的方法头、多行参数、空类、已有方法、不同缩进、Haze 开关、连续触发不重复生成；应用后重新 parse，并测试 undo。新增 AST 的成员/调用模式可能还需调整 `FindMemberFunctionCallNodes` 等遍历。

相关：[诊断](ls_diagnostics.md)、[CodeLens](code_lenses.md)、[symbols](symbols.md)。
