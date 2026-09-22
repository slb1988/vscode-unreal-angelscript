# inlay_hints.ts：参数名与推导类型提示

源码：[language-server/src/inlay_hints.ts](../../language-server/src/inlay_hints.ts)。属于静态 LSP 能力，不读取调试运行值。

## 入口与输出

`GetInlayHintsForRange(module, range)` → scope → statement/node，返回 `InlayHint[]`。

- auto：使用 parser 已推导的 ASVariable.typename，通常在变量名前显示 `[Type]`；脚本类型可用 label part 携带定义 Location。
- 参数：解析调用重载，为常量/复杂表达式显示 `Name =`。
- 可写引用：显示 `[&]`，由参数类型含 `&` 且非 const 判断。
- map iterator 有特殊的 key → value 类型展示。

构造器、变量 inline constructor、mixin 首参偏移、重载参数名不一致都需单独处理。

## 抑制噪声

通过设置和上下文跳过：禁用总开关、已命名参数、单实参调用、通用/忽略参数名、指定函数/类型、正在编辑的末尾表达式、右侧构造/Cast 已明确类型的 auto 等。

配置在 `GetInlayHintSettings`，由 server 从根清单 `UnrealAngelscript.inlayHints.*` 更新。

## 新语法接入

核心是 `GetInlayHintsForNode` 的显式 switch。普通包装表达式可递归 children；无大括号控制流的 body 可能已由 parser 拆成独立 scope，不能重复遍历最后一个 child。

若是新调用结构，需要提供参数节点列表、重载函数与隐式参数偏移；只改 PEG 不能让提示自动识别。

验证提示位置/点击跳转、partial 输入不抖动、多重载不标错参数名、设置开关和范围外节点不大量返回。相关：[parsed_completion](parsed_completion.md)、[inline_values](inline_values.md)。
