# debug_parse.ts：批量解析排障脚本

源码：[language-server/src/debug_parse.ts](../../language-server/src/debug_parse.ts)。它不是 VS Code 调试器，不与 Unreal debug server 交互。

## 行为

从 `process.argv[2]` 取目录，glob `.as` 文件，创建模块、读磁盘，逐个 `ParseModule(module, true)`，再 `ResolveModule`，打印两阶段耗时。debug=true 使失败语句和 PEG 错误可见。

当前实现用 Windows 风格 `\\**\\*.as`，把文件名同时当 moduleName/URI；只适合受控排障，不等同真实 LSP 工作区解析。未主动加载 Unreal 类型库，也未单独调用 PostProcessModuleTypes，结果不代表完整补全/诊断质量。

## 如何运行

默认语言服务 esbuild 只构建 server.ts，不包含该入口。需要手动 bundle；以下在安装好语言服务依赖后、从 `language-server/` 执行：

```sh
npx --no-install esbuild src/debug_parse.ts --bundle --platform=node --format=cjs --outfile=out/debug_parse.cjs
node out/debug_parse.cjs "D:/YourProject/Script"
```

目录是示例，换成自己的可读取脚本目录。输出在被忽略的 out/，不需提交。

## 扩展与验证

正式作为基准工具前，改成跨平台 glob、稳定模块名/URI、明确类型 fixture/生成 API 初始化，并增加断言与退出码。性能比较要固定同一份输入、Node 版本、数据库和缓存策略，不能只比较两次不等价运行的毫秒数。

一般语法修改先跑 [PEG smoke test](../testing.md)，再用此脚本定位真实项目中的坏语句。
