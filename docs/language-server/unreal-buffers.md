# unreal-buffers.ts：语言服务侧的 Unreal 消息

源码：[language-server/src/unreal-buffers.ts](../../language-server/src/unreal-buffers.ts)。提供 MessageType、Message 字段读取、readMessages 和少量 build 函数。socket 和重连逻辑在 server.ts，不在本模块。

## 与调试 codec 的关系

[extension/unreal-debugclient.ts](../../extension/src/unreal-debugclient.ts) 有一份重复的 enum/解码实现，并增加调试发送接口。两份编号 0～37 对齐；当前本模块没有末尾的 StopPIE=38。新增公共消息需要协调两份及 Unreal 端。

## 发送 build 函数

| 函数 | 消息/按顺序的 payload |
| --- | --- |
| `buildGoTo(type, symbol)` | GoToDefinition：string type、string symbol |
| `buildDisconnect()` | Disconnect：无 payload |
| `buildOpenAssets(assets, className)` | FindAssets：int32 version=1、int32 count、逐个 string path、string className |
| `buildCreateBlueprint(className)` | CreateBlueprint：string className |

RequestDebugDatabase 在 server.ts 中直接构造 5 字节消息，不在 build 函数列表中。

## 接收后的消费者

| 消息 | server.ts 行为 |
| --- | --- |
| Diagnostics | path、count、逐条文本/行/列/error/info → 编译诊断 |
| DebugDatabase / Finished | JSON 类型片段 → database；结束后 primitive + re-resolve |
| DebugDatabaseSettings | version、配置布尔字段 → ASSettings / CodeLens capability |
| AssetDatabaseInit / Database / Finished | 清空/添加删除资产；Finished 当前无额外动作 |
| ReplaceAssetDefinition | assetName、行数和文本 → WorkspaceEdit + wantSave |

AssetDatabase version=1 时，代码读取 count 后每轮 `i += 2`，每轮读 path 和 className 两个 string；mock 必须按“字符串条目数=资产对数×2”的现有读取方式构造，不能直接传 pair 数。

## 编解码约束

整数 little-endian；bool 4 字节；string 支持正长度 UTF-8 接收、负长度 UTF-16LE 接收，但写端用 binary/Latin-1，不能假设可发送任意 Unicode。

readMessages 的 length 被解释为 payload 长度，build 函数 length 则包含 1 字节 type；**这是从当前代码观察到的两个方向约定，需与引擎联调核实，不能擅自统一。** 详见 [协议指南](../guides/debug-server.md)。

pendingBuffer 是模块全局，接收半包、多包靠拼接/slice；没有显式重连重置接口、长度上限或完整畸形包保护。新增网络能力应覆盖这些边界。
