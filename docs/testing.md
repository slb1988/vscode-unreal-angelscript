# 测试与扩展回归清单

## 1. 当前基线

根 `package.json` 没有 `test` 脚本；`vscode-test` 依赖不代表仓库有已接好的集成测试。`debug_parse.ts` 是手工排障脚本。现有 formatter 测试主要打印结果，且 JS/TS 不是同一份实现。

初次文档整理时的基线验证（新增 C++ 示例的验证另见下节）：

- 下列 8 个现有生成语法用例通过。
- 文档本地链接、27 个 TypeScript 模块的文档覆盖、39 个消息编号及 JSON 示例通过静态检查。
- 用 Node 24 内置 `stripTypeScriptTypes` 在内存中加载两个 codec，验证半包/多包接收、正长度 UTF-8、负长度 UTF-16LE；核对 LSP Disconnect 发送帧。没有连接任何 Unreal 服务，也不是完整协议兼容性测试。
- 同样对 TS formatter 做只读抽查，确认 tab/CRLF 行为及 name literal 被拆开、语句中 block comment 丢失、预处理空格合并三个已记录限制；这不是宣称格式化正确。

初次文档整理时没有安装依赖、执行 esbuild 插件构建、重生成语法、运行 VS Code/Unreal 集成测试。

### 新增 C++ server 示例的验证

[示例 README](../examples/cpp-debug-server/README.md) 提供可重复执行的命令。本次增加示例时使用现有 lockfile 安装两个子项目依赖，插件 `npm run compile` 与 VS 2022 / MSVC Debug x64 构建通过；TCP smoke、真实 ASDebugSession DAP smoke，以及真实 parser/database/completion/signature 模块测试通过。未修改原有插件运行时代码、依赖清单或 lockfile。

DAP smoke 只替换 VS Code workspace API，不启动 VS Code GUI；语言 smoke 不经过 LSP 传输。因此仍未完成双 IDE GUI 或真实 Unreal 联调。以下其他项目是后续修改的验收步骤，不是已通过声明。

## 2. 不安装依赖的 PEG smoke test

在根目录用 Git Bash / bash 执行；PowerShell 用户可把 JS 内容临时保存为 `.cjs` 后用 Node 运行。

```sh
node <<'NODE'
const assert = require('node:assert/strict');
const parser = require('./language-server/pegjs/angelscript.js');
const n = require('./language-server/grammar/node_types.js');
const cases = [
  ['start_global', 'class UExample : UObject', n.ClassDefinition],
  ['start_global', 'asset Curve of UCurveFloat', n.AssetDefinition],
  ['start_class', 'UPROPERTY(SaveGame) int Score', n.VariableDecl],
  ['start_class', 'default Score = 1', n.DefaultStatement],
  ['start', 'Actor.', n.MemberAccess],
  ['start', 'Math::', n.NamespaceAccess],
  ['start', 'return Value', n.ReturnStatement],
  ['start_enum', 'First, Second = 2', n.EnumValueList],
];
for (const [startRule, source, type] of cases) {
  const ast = parser.parse(source, { startRule });
  assert.equal(ast.type, type, source);
}
console.log(`Grammar smoke: ${cases.length} cases passed`);
NODE
```

这只测 **当前提交的生成 JS**；不验证它与 `.pegjs` 是否一致，也不验证语义、补全或引擎。语法入口接收已经拆分的语句，所以示例不传整份文件、外层大括号或结尾分号。

## 3. 新语法测试矩阵

| 维度 | 至少覆盖 |
| --- | --- |
| 作用域 | 全局、命名空间、类体、函数体、嵌套代码块；非法作用域 |
| 输入过程 | 关键字前缀、裸关键字、未完成表达式、缺右括号/分号、下一行已有合法代码 |
| 词边界 | 关键字本体与 `keywordName` / `keyword_value` 区分 |
| 分隔 | 注释中的 `; { }`、字符串、`n"..."`、`f"..."`、预处理行 |
| 类型 | 原生类型、脚本类型、继承、模板、auto、const/ref、重载 |
| 文件状态 | 未保存编辑、磁盘变更、新增、删除、关闭再打开、跨文件依赖 |
| 位置 | LF/CRLF、空行、Unicode 字符串、BOM、光标位于符号末尾 |

新节点不只 assert `type`：还要断言 `children`、可空字段、`start/end`，以及转成文件范围后是否指向准确文本。

## 4. 无引擎的模块级测试建议

在安装依赖后可用 esbuild 把小型测试入口 bundle 成 CJS，直接调用：

```text
GetOrCreateModule → UpdateModuleFromContent
→ ParseModule → PostProcessModuleTypes → ResolveModule
→ Complete / GetDefinition / FindReferences / GetInlayHintsForRange
```

手工向 `database.ts` 注册最小 `UObject` / 类型 / 方法 fixture，初始化 primitive 类型；不要为测试导入 `server.ts`，它会立即建连接、启动 LSP 生命周期。每个测试隔离全局数据库状态（独立 Node 进程是最简单方式）。

补全至少断言 `label`、`insertText`/`textEdit`、`data`、排序、命名空间访问方式和 resolve 后文档；不能只比候选数。

### async / await 编辑体验回归

依赖安装后，在根目录执行：

```sh
node language-server/tests/async-await.test.mjs
# 可选：用临时 npm 工具包实测 TextMate/Oniguruma，不修改扩展依赖
npm exec --yes --package=vscode-textmate@9.3.2 --package=vscode-oniguruma@2.0.1 -- node language-server/tests/async-await.test.mjs --textmate
npm run compile
```

`tests/fixtures/async-await.as` 从实际 OptionUI 用例缩减，覆盖 `async FTask RunAsync`、await 原生 Action 工厂、普通成员调用和循环。测试使用真实 PEG/parser/database/completion/symbols/semantic_highlighting/inlay_hints，仅 stub 最小原生 API 元数据；断言大纲范围、参数作用域、hover/定义、语义 token、实参签名/inlay、半成品补全、contextual 同名标识符、修改 async 后的缓存失效及 CRLF，并保留普通 AS grammar smoke。

这些是模块级测试，不等于 VS Code 窗口目视或 Unreal 运行验收。本地编译后按 [Launch Client](development.md#在-vs-code-中运行插件) 打开游戏 Script 目录；已安装扩展不会自动使用本仓库修改，需使用开发宿主，或自行打包/安装本地 VSIX 后重载扩展。未改变已通过的运行时语义，不需要 UE 全量编译。

## 5. VS Code + Unreal 手工回归

### 语言能力

- 打开 Script 根目录；等待 DebugDatabase 完成，确认原生类和脚本类都能补全。
- 输入 `Actor.`、`Math::`、`Foo(`、命名参数，查看候选和签名的活动参数。
- 修改字段类型，确认链式补全/auto 提示更新；删除声明后不存在幽灵符号。
- F12 跳脚本；Alt+G 对原生符号触发 Unreal 源码导航。
- 引用搜索、同名局部变量、属性 Get/Set、跨模块重命名；C++/自动生成符号拒绝重命名。
- 测试 unused、命名规则、delegate 绑定错误、Super 警告及对应 Quick Fix。
- API 树/搜索/详情、颜色选择、类型层级、蓝图 CodeLens。
- 不连接引擎时检查降级，不能把一直等待的请求误判为用户代码语法错误。

### 调试

1. F5：BreakFilters 查询完成、StartDebugging 发送版本。
2. 设置有效/无效/需移动行号的断点，验证引擎确认后的 UI。
3. 命中断点：CallStack、locals/this/globals、对象/数组逐级展开。
4. hover/watch evaluate，连续发多个求值请求，观察 FIFO 是否正确。
5. continue、pause、step over/in/out、异常详情、停止调试而不关 Editor。
6. 服务器版本 ≥2 时测试数据断点；仅 write、地址非零、大小 1/2/4/8；第 5 个候选不能被误认为已验证。
7. 调试器断线与重新启动；LSP 则应按当前实现约 5 秒重连。
8. 远程源码按 moduleName 映射到本地 Script 根；多根目录同名相对路径需额外检查。

## 6. 协议回归

按 [debug server 协议](guides/debug-server.md) 分别构造两种方向的帧，不能直接把 send 函数输出交给 readMessages 当对称 round-trip。

- 一帧分成多个 TCP chunk；一个 chunk 放多帧；头部/字符串/64 位地址被截断。
- UTF-8 / 负长度 UTF-16LE 接收；空字符串、NUL 终止。
- server version 0/1/2 的栈帧、变量布局；DebugDatabaseSettings version 1～7。
- 短读后断线重连，残留 pendingBuffer 不应污染新会话（当前实现值得补测）。
- 未知消息、超长 length、损坏 JSON、无响应超时。目前不能假设有长度上限/完善错误恢复。
- mock 先绑定回环地址；完整引擎兼容性仍需真实 Unreal 联调。

## 7. 文档与提交检查

```sh
git diff --check
git status --short
```

检查相对链接存在、每个新增源码模块有文档、示例没有私人绝对路径或凭证。文档-only 修改不应夹带 bundle、lockfile 或用户原有实验文件。
