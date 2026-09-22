# assets.ts：资产和脚本类的索引

源码：[language-server/src/assets.ts](../../language-server/src/assets.ts)。不读 Unreal 资产文件，也不是文件系统浏览器。

## 数据与接口

- `AssetPathToClass`：assetPath → className。
- `ClassToReferencingAssets`：className → assetPath[]。
- `AddAsset`、`RemoveAsset`、`ClearDatabase`：由 server 消费 AssetDatabase* 消息后调用。
- `GetAssetsImplementing`：先查完整类名，查不到且以 U/A 开头时尝试去前缀，适配引擎类命名。
- `GetShortAssetName`：取最后 `/` 后内容，供 UI 显示。

主要消费者为 CodeLens 和 `angelscript.openAssets` 命令。AssetDatabaseInit 清空旧索引；同批数据为空 className 时表示删除。

## 扩展注意

当前同一 assetPath 从一个类变成另一个类时，AddAsset 没先移除旧类的反向索引；若增加增量更新/重命名能力，需要同时维护两张表，而不是只覆盖正向 Map。

返回的资产列表是内部数组，不应由 UI 消费者随意原地修改。新增字段时先扩展线协议版本/解析，再设计索引，不能把资产磁盘路径与 `/Game/...` 对象路径混用。

测试重复添加、删除不存在项、换类、完整重新同步和 U/A 前缀回退。相关：[code_lenses](code_lenses.md)、[unreal-buffers](unreal-buffers.md)。
