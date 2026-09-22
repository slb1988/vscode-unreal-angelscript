# as_formatter.ts：独立格式化原型

源码：[language-server/src/as_formatter.ts](../../language-server/src/as_formatter.ts)。关联：[原有英文规则](../../language-server/as_formatter_rules.md)、[TS 手工测试](../../language-server/test_formatter.ts)、[JS 参考实现](../../language-server/test_formatter.js)。

> 状态：本轮分析开始时以上文件均为工作区未跟踪内容；本次只为它们补充说明，未覆盖、提交或修改。server.ts 没有导入格式化器、声明 formatting capability 或注册 handler，因此目前不能在插件中直接使用 Format Document。

## 算法

```text
formatASSource(source)
  → lex：正则 token 化
  → Splitter.split：statement / scope / comment / preproc / blank
  → Emitter.emit：缩进、空格、换行
```

不依赖 PEG、AST、类型数据库，也不需要 Unreal。与 parser 的分号/括号拆分只是思路相似，不是复用同一实现。

## 当前代码实际风格

- INDENT_UNIT 是 tab，不是文件头注释所说的四个空格。
- 大括号独占一行（Allman），不是文件头注释写的 K&R。
- 固定 CRLF 输出，末尾带换行。
- MAX_LINE=100，参数内按逗号/首参尝试折行，续行缩进一层；不是所有长行都能限制到 100。
- UPROPERTY/UFUNCTION/UCLASS/USTRUCT 独立成行；宏列表当前不包括 UENUM/UMETA。

## 不能忽略的原型限制

- JS 测试文件复制了一套 formatter，并含 TS Splitter 没有的无大括号控制流拆分逻辑；运行 JS 不等于验证 TS 实现。
- TS 测试只打印结果，没有断言；默认输入路径是作者本机文件，运行时必须显式传入自己的文件。
- 英文规则文档、TS 文件头与 TS/JS 实现有差异，以实际 TS 路径验证，不能直接照抄为完成状态。
- `n"..."` 没有整体字符串 token 规则，可能输出为 `n "..."`；多行字符串也需专门测试。
- 语句中的 block comment 会在扫描时被跳过；preproc token 用无间隔 join，可能改变指令文本。
- `<` / `>` 无类型上下文，比较与模板空格不可靠。格式化前后语义不变尚无完整验证。

## 建议的 LSP 接入路线（尚未实现）

1. 先建立直接调用 TS `formatASSource` 的 golden tests，而不是继续维护 JS 副本。
2. 测试保留注释/字面量/预处理，格式化前后 token/AST 一致，以及 `format(format(x)) === format(x)`。
3. 处理 tabSize/insertSpaces 和原文件 EOL，不应默默改写整个项目风格。
4. 在 server 注册 documentFormattingProvider 和 onDocumentFormatting；输入必须取当前未保存文档内容。
5. 返回 TextEdit（原型可整文档替换，后续再做最小 diff）；独立格式化无需依赖 Unreal 类型就绪。
6. 先手工 Format Document 回归，再考虑 formatOnSave/range formatting，避免自动破坏代码。

用 esbuild 单独编译 TS 测试比假设 ts-node 已安装更符合当前依赖结构：

```sh
# language-server/ 内；依赖已安装
npx --no-install esbuild test_formatter.ts --bundle --platform=node --format=cjs --outfile=out/test_formatter.cjs
node out/test_formatter.cjs "D:/YourProject/Script/Example.as"
```

以上命令只输出格式化文本；本轮文档工作未执行它们。
