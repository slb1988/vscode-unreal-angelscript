# inline_values.ts：暂停调试时的行内值描述

源码：[language-server/src/inline_values.ts](../../language-server/src/inline_values.ts)。

## 与 InlayHint 的区别

`ProvideInlineValues(module, position)` 接收调试停止位置，输出标准 LSP `InlineValueVariableLookup` / `InlineValueEvaluatableExpression`。它只告诉 VS Code 在哪里查哪个变量/表达式；实际运行值由调试会话和 Unreal 提供。

server 使用 `params.context.stoppedLocation.start`，不是扩展文件里遗留的私有 ProvideInlineValuesRequest。

## 当前选择规则

- 从停止 scope 向父函数 scope 走，显示暂停点之前声明的局部变量与参数。
- 对当前类的直接 Identifier 成员赋值/复合赋值，逆序选最近使用并去重。
- 在函数上方显示 this；ActorComponent 或具有 Owner 属性的对象可显示 Owner。
- 函数结束边界有 offset-1 回退，避免错判为类体。
- 普通 struct 仅允许 `WhitelistedInlineStructs` 中的 FVector/FName/FString/FColor 等；模板实例另行放行。

所有类别可由 `UnrealAngelscript.inlineValues.*` 设置控制。

## 扩展

新增可展示 struct 时加入白名单前，验证 Unreal 对该值的显示成本/格式。新成员访问/赋值语法需要调整 `AddScopeInlineValues`，当前不是任意复杂左值都识别。

新的 evaluatable expression 必须同时被 [debug adapter](../extension/debug.md) 与 Unreal 求值支持；LSP 能推导类型不意味着 debug server 能执行该表达式。

验证暂停行前后、嵌套作用域、重复赋值、this/Owner、设置关闭、步进后的刷新；不要从此模块自行发 RequestEvaluate，避免另建无关联求值队列。
