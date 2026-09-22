# as_parser.ts：模块、作用域与语义分析

源码：[language-server/src/as_parser.ts](../../language-server/src/as_parser.ts)。它是多数语言能力的共同基础，不只是对 PEG 的简单封装。

## 核心对象

| 对象 | 关键内容 |
| --- | --- |
| `ASModule` | 文件内容/TextDocument、模块名/URI、loaded/parsed/typesPostProcessed/resolved 状态、根作用域、数据库声明、semanticSymbols、依赖 |
| `ASScope` | 父子作用域、语句和有序 element 链、scopetype、dbtype/dbfunc/dbnamespace、variables |
| `ASStatement` | content、文件偏移、ast、parseError、endsWithSemicolon、缓存信息 |
| `ASVariable` | 类型、参数/成员/全局标记、auto、访问权限、使用状态、声明/初始化范围 |
| `ASSemanticSymbol` | 符号类别、绝对范围、container_type/symbol_name、isWriteAccess/isAuto/noColor |
| `ASDelegateBind` / `ASAnnotatedCall` / `ASLiteralAsset` | delegate 诊断、颜色等调用注解、字面量资产位置 |

`ModuleDatabase` 按小写模块名索引，`ModulesByUri` 用 `NormalizeUri`（decode + 小写）。`displayUri` 保留展示用 URI。多根同相对路径、大小写敏感文件系统要额外验证，不要自行复制路径归一化规则。

## 生命周期

```text
GetOrCreateModule
  → UpdateModuleFromDisk / UpdateModuleFromContent / UpdateModuleFromContentChanges
  → ParseModule
      ParseScopeIntoStatements → ParseAllStatements → GenerateTypeInformation
  → PostProcessModuleTypes
      ProcessScriptTypeGeneratedCode
  → ResolveModule
      ResolveAutos → DetectScopeSymbols
      → 确保依赖模块及继承链已解析/后处理，必要时再 resolve
```

`LoadAndParseModule` 只负责加载/parse，不等于已经 resolved。`ClearModule` 移除旧模块的类型/全局声明并失效关联状态；重新解析不要在旧数据库对象上无限追加。

## 三个特别重要的扩展点

### 声明与作用域

`GenerateTypeInformation` 把 AST 提升为 DBType / DBMethod / DBProperty 和局部变量。函数/类型体通过“前一个声明语句 + 后一个 ASScope”关联。

For/foreach 等用 `MoveStatementToSubScope` 创建合成作用域，保证循环变量的可见范围；if/else/while/case 无大括号体也可被移动为独立语句。新增控制流不能只把 AST children 当普通表达式递归。

新顶层声明还要检查 `DetermineScopeType` 与 `PreParseTypes` 的正则预索引，后者帮助按标识符找到尚未完整解析的依赖模块。

### 表达式类型

`ResolveTypeFromExpression` 处理标识符、字面量、成员、namespace、调用、Cast、运算符、模板构造等。`ResolveFunctionFromExpression` / `ResolveFunctionOverloadsFromExpression` 负责函数和重载；operator 名称映射由 `GetOverloadMethodForOperator` 等处理。

新增会返回值的表达式，应明确返回 DBType；没有返回值的语句不必硬造类型。链式补全和 auto 推导都依赖此处。

### 语义符号

`DetectNodeSymbols` 显式遍历各类 AST，填充 semanticSymbols、读写/unused 信息、依赖、delegate 绑定与 annotated calls。

这是新语法最容易遗漏的环节：PEG 解析成功不代表子表达式被访问；遗漏会导致引用、rename、颜色、unused 同时出错。符号应使用既有 `AddIdentifierSymbol` / `AddTypenameSymbol` 路径，保证来源和范围一致。

## 容错与缓存

- `ASKeywords` 用于 `CheckIdentifierIsPrefixForValidSymbol` 判断正在输入的关键字前缀，降低误标 UnknownError；不生成 CompletionItem。
- `GetCachedStatementParse` 复用相同内容/作用域类型的临近语句 AST；AST 相对范围不能被改成上一次文件绝对位置。
- `SplitStatementBasedOnEdit` 在正在编辑且解析失败时尝试按换行拆语句，避免缺少分号吞掉下一行。
- `lastEditStart/End` 让补全、诊断、提示在输入期间减少闪烁。
- `ClearAllResolvedModules` 清语义分析结果，不等价于重新 parse 或重新生成所有隐式 API；新设置需要哪一级失效要明确设计。

## 自定义字面量/预处理

`DetectFormatStringSymbols` 会在 f-string 内重新解析插值，并修正坐标。新字符串/嵌入语言同时检查语句扫描器、PEG、补全 ignore table 与 TextMate。预处理行目前被跳过，并没有完整条件求值。

## 验证

至少检查：AST、scope 可见范围、auto 类型、符号范围与 read/write、跨文件依赖、未完成输入、删除后数据库清理。入口示例见 [自定义语法](../guides/custom-syntax.md)，类型侧见 [database](database.md)。
