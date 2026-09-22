# code_lenses.ts：模板与 Unreal 资产入口

源码：[language-server/src/code_lenses.ts](../../language-server/src/code_lenses.ts)。入口 `ComputeCodeLenses`，返回带命令的 CodeLens；当前不依赖单独 resolve 阶段。

## 空文件模板

server 启动扫描各脚本根 `.vscode/templates/*.as.template`，传给 `LoadFileTemplates`。文件名可带排序号，例如 `10.My_Actor.as.template`；去编号后作为名称，当前下划线替换只处理第一个。名称按小写去重。

未提供同名模板时补 Actor/Component 默认模板。空白 `.as` 文件显示 Create ...，执行 `editor.action.insertSnippet`，模板中可使用 `${TM_FILENAME_BASE}`、`$0` 等 VS Code snippet 变量。

模板扫描是初始化行为，没有独立模板 watcher；更新后通常需重启语言服务。多个根同名模板的加载/优先级应实测，不要假设固定覆盖顺序。

## 蓝图与数据资产

类 scope → `assets.GetAssetsImplementing`：存在资产时显示 Implemented by / Used by，并执行 `angelscript.openAssets`；无资产且允许时显示 Create Blueprint/Asset，交由 `angelscript.saveAndCreateBlueprint`。

创建能力要求 Unreal DebugDatabaseSettings version ≥4；排除 NotBlueprintable、AVolume。显示规则还参考 UDataAsset 与 `codeLenses.showCreateBlueprintClasses`。

字面量资产目前只对 UCurveFloat 继承类型提供 Edit in Unreal，目标路径为 `/Script/AngelscriptAssets.<Name>`，经 `angelscript.saveAndEditAsset`。

## 扩展

新增模板最轻量，不必改 PEG。新增资产类型编辑按钮时确认 Unreal 支持对应路径/编辑/回写机制，再扩展类型筛选。不要给所有类型显示引擎无法执行的按钮。

完整操作链：CodeLens → 客户端保存前置命令（如需）→ LSP executeCommand → unreal-buffers → Unreal。LSP handler 当前也受类型数据库就绪门槛限制，不能承诺无引擎时空文件模板一定显示。

验证 empty file、多个资产、不可创建类型、未保存文档、断线与引擎回写。相关：[assets](assets.md)、[extension](../extension/extension.md)。
