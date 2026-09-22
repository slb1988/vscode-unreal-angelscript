# ls_diagnostics.ts：诊断合并与本地检查

源码：[language-server/src/ls_diagnostics.ts](../../language-server/src/ls_diagnostics.ts)。

## 两个来源

- `CompileDiagnostics`：Unreal 编译/重载结果，经 server 收 Diagnostics 消息后调用 `UpdateCompileDiagnostics`，source 为 `as`。
- `ParseDiagnostics`：本地语义辅助检查，由 `UpdateScriptModuleDiagnostics` 生成，source 通常为 `angelscript`。

`NotifyDiagnostics` 合并两者，必要时 `TrimDiagnosticPositions` 收紧引擎给的整行范围；`OnDiagnosticsChanged` 回调最终由 server publishDiagnostics。它不负责启动编译器；保存后的实际编译由 Unreal 执行。

## 当前本地规则

- 打开的函数体内未使用参数/局部变量；通过 Unnecessary tag 灰显。
- delegate 绑定目标是否存在、UFUNCTION 是否可绑定、UnrealName 和参数/返回值/ref 是否匹配。
- 覆盖父方法时缺 Super 调用、缺 override。
- Unreal 命名约定：A/U/F/E、bool 的 b 前缀、函数/变量大小写等；细粒度变量/函数检查只对已打开文件运行。

不是完整 AngelScript 类型检查器。PEG parseError、UnknownError 语义颜色不等于这里会发布一条对应编译错误；真正编译合法性由引擎判断。

## 配置与输入容错

`GetDiagnosticSettings()` 返回命名检查、markUnreadVariablesAsUnused 设置。parser 的 isUnused/hasAnyUsages/usages 和编辑范围决定是否提示；部分正在编辑的 delegate/变量场景被暂时抑制。

`AreDiagnosticsEqual` 减少无变化通知；清空旧诊断、文件删除和 compile diagnostics 同时存在的情况都要测试。

## 新诊断与 Quick Fix

1. 在相关 scope/函数/专项检查处生成 Diagnostic，设置准确 range、severity、source。
2. 不完整输入下先确认数据足够，避免“每敲一个字符就报错”。
3. 需要修复动作时加结构化 `data`。已有 `delegateBind`、`superCall` 被 code_actions 消费；不要靠解析英文 message 关联修复。
4. 新设置同步根清单、server 配置与刷新逻辑。
5. 测试出现、更新、消失、撤销、文件关闭/删除，避免旧错误常驻。

相关：[code_actions](code_actions.md)、[Unreal 消息](unreal-buffers.md)。
