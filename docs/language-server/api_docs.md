# api_docs.ts：API 浏览与搜索数据

源码：[language-server/src/api_docs.ts](../../language-server/src/api_docs.ts)。消费 database，不向 Unreal 单独请求某个方法文档。

## 三个入口

| 函数 | 私有 LSP 请求 | 输入/输出 |
| --- | --- | --- |
| `GetAPIList(root)` | `angelscript/getAPI` | namespace 标识 → type/id/data/label 节点数组 |
| `GetAPISearch(filter)` | `angelscript/getAPISearch` | 搜索文本 → 函数/属性结果 |
| `GetAPIDetails(data)` | `angelscript/getAPIDetails` | 标识数组 → Markdown |

server 等 HasTypesFromUnreal；客户端 tree/webview 见 [extension](../extension/extension.md)。

## 标识约定

`data` 首项为 namespace / function / method / global / property；后续是限定名，或 type + member name，以及可选方法 ID。TreeItem 的 `__ns_` 等前缀用于避免不同类别 ID 冲突，GetAPIList 会剥掉这些前缀。

根列表主要列 namespace，不是完整类树；进入 namespace 后展示函数/属性。搜索递归 namespace 和部分原生类型，跳过构造函数、op 开头方法、脚本声明类型、enum、模板、delegate/event 等类型分支。不要把它当成 workspace symbols 的等价实现。

搜索按空格切 phrase，短 phrase 偏向前缀匹配，长 phrase 可包含匹配；方法签名和描述来自 DBMethod/DBProperty + documentation。

## 扩展

- 新节点类别需同时修改服务端 list/search/details 与客户端 TreeItem 分支。
- 重载标识尽量携带 ID；当前某些搜索结果不携带 ID，详情会回退取匹配方法，不保证精确展示所选重载。
- 增加类/模板/脚本 API 搜索时明确过滤策略和结果数量，避免每次输入都生成全数据库巨大列表。
- `shouldSkipApiFunction` 当前恒为 false，可作为额外方法过滤入口，但不要误以为列表/搜索已完全共享过滤逻辑。

测试多 namespace 同名成员、重载、mixin 的隐式接收参数、无文档/过期 ID 和断线重连后内容。
