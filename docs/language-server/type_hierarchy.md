# type_hierarchy.ts：继承层级

源码：[language-server/src/type_hierarchy.ts](../../language-server/src/type_hierarchy.ts)。

## 三个阶段

1. `PrepareTypeHierarchy` 从光标 semantic symbol 的 Typename/Namespace 解析 DBType。
2. `GetTypeHierarchySupertypes` 取当前 DBType 的直接父类。
3. `GetTypeHierarchySubtypes` 遍历 TypesById，选择 supertype 等于当前类型名的直接子类。

返回的 TypeHierarchyItem.data 保存类型名，后续请求用它查数据库。展示分别使用 Class/Struct/Enum；原生类型用 Interface kind，URI 默认空，因为没有脚本源码位置。

## 扩展边界

当前模型以单一 supertype 为主，子类查找是全库扫描。新增接口/多继承关系或大型项目索引前，先扩展数据库，再修改这里的上下级关系。

同名不同 namespace 若需要精确区分，不能继续只使用未限定 name 作为 data 和匹配键；应一起设计稳定、作用域明确的标识。

验证脚本→脚本→原生链、无父类、多个直接子类、删除/改父类后缓存、空 URI 的原生节点 UI。该模块不负责 C++ 源码导航，相关回退在 [symbols](symbols.md)。
