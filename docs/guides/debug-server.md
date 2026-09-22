# 如何与 Unreal debug server 交互

> 本文根据本仓库 TypeScript 的实际编码/读取顺序整理。Unreal 端 C++ 实现不在此仓库；以下是客户端兼容约定，不代替引擎协议规范，新增能力必须与真实服务器联调。

想实际运行这套协议，可先使用 [C++ 教学 server](../../examples/cpp-debug-server/README.md)，配合 [VS / VS Code 双 IDE 指南](cpp-debug-server.md)。该示例模拟执行，不是 Unreal 服务实现。

## 1. 两条连接与三个端口

| 连接 | 用途 | 实现 |
| --- | --- | --- |
| LSP → Unreal | 类型数据库、编译诊断、资产、原生源码导航 | server.ts + unreal-buffers.ts |
| DAP adapter → Unreal | 断点、暂停、单步、栈、变量、表达式求值 | debug.ts + unreal-debugclient.ts |
| VS Code → 本地 DAP adapter | 标准 DAP，不直接发 Unreal 二进制包 | ASConfigurationProvider 建随机端口 listener |

Unreal 默认端口 `27099`；LSP Node inspector 为 `6009`；本地 DAP 的 config.debugServer 是随机端口。不要混填。

LSP 主机固定 `127.0.0.1`，端口取 `UnrealAngelscript.unrealConnectionPort`；DAP 可由 launch.hostname/port 覆盖。远程 DAP 不会把 LSP 数据库连接也自动变成远程。

连接层未实现 TLS/身份认证。默认按本机可信编辑器使用，不要把调试端口直接暴露到不可信网络；远程场景使用受控隧道/网络策略。

## 2. 会话时序

### 语言服务

```text
启动/配置换端口 → connect
  → 约 1 秒后 RequestDebugDatabase
  ← DebugDatabaseSettings、若干 DebugDatabase JSON 块
  ← DebugDatabaseFinished
  → FinishTypesFromUnreal + AddPrimitiveTypes + ReResolveAllModules
  ← Diagnostics / AssetDatabase* / ReplaceAssetDefinition（持续）
断线 → 约 5 秒后重连
```

具体数据库/资产消息的服务器发送顺序需按引擎确认。客户端也会在最后一块 DebugDatabase 后 1 秒超时视为结束；“连接超时 20 秒”没有让完整语义能力自动离线可用。

### 调试适配器

```text
DAP initialize
  → 临时连接 → RequestBreakFilters
  ← BreakFilters → 断开临时连接
  → initialize response + InitializedEvent
DAP launch
  → 再连接 → StartDebugging(adapterVersion=2)
  ← DebugServerVersion（更新解码能力）
  → 断点/异常过滤设置、等待 configurationDone
  ← HasStopped → DAP stopped
  → RequestCallStack / RequestVariables / RequestEvaluate
DAP disconnect
  → StopDebugging + Disconnect
```

它不启动 Unreal，也不因停止调试而关闭 Editor。StopPIE 是单独的动作。缺少 BreakFilters 回包会阻塞初始化；mock server 不能只实现 StartDebugging。

## 3. 帧格式：一定区分方向

两端都用 4 字节 little-endian 长度 + 1 字节 MessageType，但**当前收发代码对长度的定义不同**：

```text
客户端 → Unreal（send* / build*）
  uint32 LE length = 1 + payload.length
  uint8     type
  bytes     payload
  总长度 = 4 + length

Unreal → 客户端（readMessages 当前解释）
  uint32 LE length = payload.length
  int8      type（当前消息编号在非负范围）
  bytes     payload
  总长度 = 5 + length
```

依据：发送函数写 `msg.length - 4`；readMessages 在读过 length 和 type 后，检查 `msglen <= pendingBuffer.length - 5`，并消费 `5 + msglen`。

例如客户端 Continue=6 无 payload 是 `01 00 00 00 06`；供当前 reader 接收的 HasContinued=12 无 payload 应是 `00 00 00 00 0c`。**不能把发送帧直接喂给接收器当 round-trip 测试，也不能未核对 Unreal 就“修正 off-by-one”。**

供 mock 使用的独立构造示意（只造 buffer，不建立网络连接）：

```js
function clientFrame(type, payload = Buffer.alloc(0)) {
    const header = Buffer.alloc(5);
    header.writeUInt32LE(payload.length + 1, 0);
    header.writeUInt8(type, 4);
    return Buffer.concat([header, payload]);
}
function frameForCurrentClientReader(type, payload = Buffer.alloc(0)) {
    const header = Buffer.alloc(5);
    header.writeUInt32LE(payload.length, 0);
    header.writeUInt8(type, 4);
    return Buffer.concat([header, payload]);
}
```

两份 readMessages 都有模块级 pendingBuffer，拼接处理 TCP 半包/粘包。没有完整的最大包长校验/重连缓存重置；这是要补测试的现状，不是网络输入已经安全的保证。

## 4. 基础字段

| 记号 | 编码 |
| --- | --- |
| I | int32 little-endian |
| B | bool，按 I 存储，非零=true（不是 1 byte） |
| U8 / I8 | 单字节无符号/有符号 |
| A | uint64 little-endian，JS bigint |
| S | 下述字符串格式 |

字符串接收：先读 I；正值 n 表示读取 n 字节 UTF-8，负值 -n 表示读取 n 个 UTF-16LE code unit（2n 字节），最后的 NUL 会移除。

字符串发送：`writeString` 用 `str.length + 1`，再 `Buffer.from(str + "\0", "binary")`。这是 Latin-1/binary 路径，**不是任意 Unicode 可用的 UTF-8 encoder**；发送中文路径/符号需修改两端一致的编码约定并联调，不能只换 Buffer.from 编码而不修长度。

## 5. MessageType 编号表

两个客户端的 0～37 一致；StopPIE 当前只在调试端 enum 中出现。此表仅代表编号，不表示每个客户端都实现收发。

| ID | 名称 | ID | 名称 |
| --- | --- | --- | --- |
| 0 | Diagnostics | 20 | Evaluate |
| 1 | RequestDebugDatabase | 21 | GoToDefinition |
| 2 | DebugDatabase | 22 | BreakOptions |
| 3 | StartDebugging | 23 | RequestBreakFilters |
| 4 | StopDebugging | 24 | BreakFilters |
| 5 | Pause | 25 | Disconnect |
| 6 | Continue | 26 | DebugDatabaseFinished |
| 7 | RequestCallStack | 27 | AssetDatabaseInit |
| 8 | CallStack | 28 | AssetDatabase |
| 9 | ClearBreakpoints | 29 | AssetDatabaseFinished |
| 10 | SetBreakpoint | 30 | FindAssets |
| 11 | HasStopped | 31 | DebugDatabaseSettings |
| 12 | HasContinued | 32 | PingAlive |
| 13 | StepOver | 33 | DebugServerVersion |
| 14 | StepIn | 34 | CreateBlueprint |
| 15 | StepOut | 35 | ReplaceAssetDefinition |
| 16 | EngineBreak | 36 | SetDataBreakpoints |
| 17 | RequestVariables | 37 | ClearDataBreakpoints |
| 18 | Variables | 38 | StopPIE（仅调试端） |
| 19 | RequestEvaluate | | |

## 6. 调试消息 payload

按线上的字段顺序列出，C=客户端、U=Unreal：

| 消息/方向 | payload |
| --- | --- |
| StartDebugging C→U | I adapterVersion，当前 2 |
| DebugServerVersion U→C | I serverVersion |
| RequestBreakFilters C→U | 空 |
| BreakFilters U→C | I count，重复 S filter + S label |
| BreakOptions C→U | I count，重复 S filter |
| ClearBreakpoints C→U | S pathname、S moduleName |
| SetBreakpoint C→U | S pathname、I line、I id、S moduleName |
| SetBreakpoint U→C | S filename、I correctedLine、I id |
| HasStopped U→C | S reason、S description、S text；异常 text 供 exceptionInfo |
| RequestCallStack C→U | 空 |
| CallStack U→C | I count，逐帧 S function + S sourcePath + I line；serverVersion>0 再读 S moduleName |
| RequestVariables C→U | S variablePath |
| Variables U→C | I count；逐项 S name + S value + S type + B hasMembers；serverVersion≥2 再读 A address + I8 valueSize |
| RequestEvaluate C→U | S expression、I frameId |
| Evaluate U→C | S name、S value、S type、B hasMembers（此读取路径没有地址字段） |
| SetDataBreakpoints C→U | U8 count；逐项 I id + A address + U8 size + I8 hitCount + B cppBreakpoint + S name |
| ClearDataBreakpoints U→C | I count + count 个 I id；count=0 表示清全部 |

StopDebugging、Pause、Continue、StepOver/In/Out、EngineBreak、Disconnect、StopPIE 等发送方法无 payload。HasContinued 接收事件不读 payload。PingAlive 在此没有对应活跃处理逻辑，不能当现成心跳机制。

栈帧/变量/求值请求按各自 FIFO 等待队列匹配，没有 wire request ID；保持同类回复顺序。`variablesReference` 是 DAP 本地句柄，不是内存地址，展开时再转换为 `0:%local%.Actor` 等路径。

## 7. LSP 数据与编辑器操作 payload

| 消息/方向 | payload |
| --- | --- |
| RequestDebugDatabase C→U | 空 |
| DebugDatabase U→C | S JSON 字符串，逐块 AddTypesFromUnreal |
| DebugDatabaseFinished U→C | 当前不读字段 |
| Diagnostics U→C | S path、I count；逐项 S text + I line + I character + B isError + B isInfo |
| AssetDatabaseInit U→C | 当前不读字段，清空索引 |
| AssetDatabase U→C | I version=1、I stringEntryCount；重复 S assetPath + S className；空 className 删除 |
| AssetDatabaseFinished U→C | 当前无额外动作 |
| GoToDefinition C→U | S typeName、S symbolName |
| FindAssets C→U | I version=1、I assetCount、逐个 S path、S className |
| CreateBlueprint C→U | S className |
| ReplaceAssetDefinition U→C | S assetName、I lineCount、逐个 S line |

AssetDatabase 的循环为 `i += 2`，所以读取 count 是字符串条目数，不是 pair 数；FindAssets 的 count 则是资产数。

Diagnostics 行号按 1 基转 LSP 零基；character 虽读出却未用于最终范围（先标整行，再 trim）。ReplaceAssetDefinition 会应用 WorkspaceEdit，然后通知客户端保存；现有客户端执行 saveAll，是带编辑副作用的消息。

### DebugDatabaseSettings（U→C）

先读 I version，再依次读：

| 条件 | 字段 |
| --- | --- |
| 所有当前版本 | B automaticImports（读掉但不用；非自动 imports 不再支持） |
| version≥2 | B floatIsFloat64 |
| version≥3 | B useAngelscriptHaze |
| version≥4 | **没有新增字段**，仅以版本判断支持 CreateBlueprint |
| version≥5 | B deprecateStaticClass、B disallowStaticClass |
| version≥6 | B exposeGlobalFunctions |
| version≥7 | B deprecateActorGenerics、B disallowActorGenerics |

这是数据库设置版本，和 DebugServerVersion / debugAdapterVersion 是三个不同概念。

## 8. 新增协议能力的步骤

1. 定义用途/方向/字段/版本/超时/失败结果；确定是 LSP 命令还是 DAP 请求。
2. 在 Unreal 端确认空闲消息编号。两个 TS enum **不能各自盲目追加**：LSP 目前少 StopPIE，直接递增会占用 38。先对齐或显式赋同一编号。
3. 对需要的连接增加 builder/send；另一客户端至少保持共用编号正确。
4. 接收方按方向解帧、逐字段解码；新增响应为 DAP 增 event+receive 或为 LSP 增 handler。
5. 发 capability 或基于 version 选择新布局；旧服务器未支持时禁止无条件读新增字段。
6. 如果改变数据语义，再更新 DB/parser/UI 与配置/文档；不要让 UI 暴露服务器无法执行的按钮。
7. mock 测半包/粘包、UTF 字符串、未知包、超时/断线，然后真实 Unreal 联调。

只增加补全或语法通常无需增加协议消息；不要为了编辑器候选启动额外调试会话。

## 9. 联调排障顺序

- TCP 是否连到正确实例/端口？LSP 与 DAP 的 host/port 是否一致？
- 帧 length 方向是否正确，字段有没有把 B 当 U8？
- initialize 是否收到 BreakFilters？DebugServerVersion 是否在版本相关 payload 解码前已更新？
- 数据库是否 Finished、模块是否 resolved？
- 栈 sourcePath 不在本机时 moduleName 能否映射到 Script 根？
- FIFO 是否被丢包/多发/乱序回复破坏？断线后的 pendingBuffer 是否残留？

DAP trace（launch.trace）记录 DAP 侧，不等于自定义 TCP 抓包。加 TCP 日志时优先记录方向/type/length/version，默认不要完整输出含源码、表达式或运行值的 payload。

源码细节：[debug](../extension/debug.md)、[unreal-debugclient](../extension/unreal-debugclient.md)、[server](../language-server/server.md)、[unreal-buffers](../language-server/unreal-buffers.md)。
