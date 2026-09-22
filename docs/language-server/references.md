# references.ts：引用与重命名

源码：[language-server/src/references.ts](../../language-server/src/references.ts)。

## 入口

- `FindReferences(uri, position)`：generator，返回 `Location[]`。
- `PrepareRename(uri, position)`：返回可重命名范围，或禁止操作的 ResponseError。
- `PerformRename(uri, position, newName)`：generator，返回 `Map<uri, TextEdit[]>`，由 server 转 WorkspaceEdit。

遍历约 100 个候选模块后 `yield null`，server 用 timer 继续推进，避免大工作区长时间阻塞。

## 符号匹配

来自 `getSymbolAtOrBefore` 的 `ASSemanticSymbol`，主要匹配 type / container_type / symbol_name，不是按文本全局替换。

- 局部变量和参数限制在声明作用域范围内。
- 成员/全局 accessor 与函数互相扩展查找。
- 跨文件候选由 `GetModulesPotentiallyDependentOnSymbol` 选取。
- FindReferences 对成员函数追溯最上层父定义并纳入派生类型，还可加入 `auxiliarySymbols`（生成 API 关联）。
- PerformRename **没有完全复刻**引用查找的派生/辅助符号扩展，不能保证所有 override/生成 API 会随一次 rename 全链更新。

## 重命名保护

C++ 声明、自动生成方法/属性不允许 rename；未知符号直接不给结果。替换时跳过表示推导类型的 `auto`，类型重命名跳过源码中的 `Super`，accessor 使用去掉 Get/Set 前缀后的显示名。

产生改动后部分模块被标记为需要重新 resolve；真正应用编辑由客户端完成。

## 新语法如何支持引用

若新语法只是包装已有表达式，首先让 `DetectNodeSymbols` 递归采集即可；不要在此硬写新语法的正则。若新增符号类别，再增加候选模块、声明作用域与重命名限制。

## 验证

- 同名局部变量/嵌套遮蔽不互相污染。
- 相同属性的 GetX/SetX/X，命名空间同名类型、继承重载。
- f-string 和 delegate 函数字符串的范围准确，不改引号或格式内容。
- 重命名生成符号被拒绝；真实声明和跨文件引用可撤销。
- 大项目 generator 能完成；文件变化/关闭/删除不产生过期编辑。

相关：[as_parser](as_parser.md)、[symbols](symbols.md)。
