# 安装、构建与调试插件

## 前置条件

- Node.js / npm。建议 Node 22 LTS 或满足工具要求的更新版本；仓库未固定 Node 版本，esbuild 0.27.x 要求 Node ≥18，重新生成语法还需满足 Peggy 5.1.0 的环境要求。
- VS Code；分发清单最低为 `^1.67.0`，与所捆绑的 `vscode-languageclient 8.1.0` 要求一致，建议使用当前稳定版；本机安装验证使用 1.138.0。
- 验证完整功能需要带 AngelScript 支持的 Unreal Editor/游戏进程，并启用对应 debug server。仅学习调试接入时可先用 [独立 C++ 示例](../examples/cpp-debug-server/README.md)，不需 Unreal。

两个子目录独立管理依赖和 lockfile；根目录不是 npm workspace。

## 安装依赖

仓库提供的入口（根目录）：

```sh
npm install
```

它的 `postinstall` 会依次在 `extension/`、`language-server/` 执行 `npm install`；语言服务还有 `prepare` 构建脚本。安装可能改变 lockfile，提交前检查差异。

如希望按已提交锁文件恢复两个子项目，可在根目录执行：

```sh
npm ci --prefix extension
npm ci --prefix language-server
```

锁文件与清单不一致时应调查原因，不要直接删除锁文件。

## 编译与 watch

```sh
# 根目录
npm run compile
npm run compile:extension
npm run compile:language-server
```

输出：

- `extension/dist/extension.js`
- `extension/dist/debugAdapter.js`
- `language-server/dist/server.js`

两个 `esbuild.js` 都输出 CommonJS bundle，非生产模式带 source map，外置 `vscode` 模块。**esbuild 不做完整 TypeScript 类型检查**，`out/` 是 tsconfig 的旧输出目录，不是当前默认 bundle 目录。

watch 可开两个终端，避免依赖根脚本未声明的 `npm-run-all`：

```sh
npm run watch:extension
# 另一个终端
npm run watch:language-server
```

`npm run watch` 依赖 PATH 中的 `npm-run-all`；仓库未把它声明为依赖。默认构建任务 `npm: compile`（Ctrl+Shift+B）使用 esbuild 的退出状态，不再套用 `$tsc` matcher；旧 watch 任务的 `$tsc-watch` matcher 仍不对应 esbuild 日志，推荐直接使用上面两个 watch 命令。

生产 bundle 可单独构建：

```sh
cd extension
node esbuild.js --production
cd ../language-server
node esbuild.js --production
```

注意默认 `vscode:prepublish` 会重新运行普通 `compile`，并不保留上述生产参数。

## 修改语法后重新生成

`angelscript.js` 文件头记录生成器为 **Peggy 5.1.0**。仓库未声明 peggy 依赖；有兼容 CLI 时：

```sh
# 根目录
npm run pegjs:compile
```

也可显式使用版本，以下命令可能从 npm 下载工具，需在允许联网的开发环境运行：

```sh
cd language-server/pegjs
npx --yes peggy@5.1.0 angelscript.pegjs --allowed-start-rules start,start_global,start_class,start_enum
```

随后回根目录运行 `npm run compile`，并检查源语法和生成 JS 的 diff。不要手改生成文件。

`npm run pegjs:test` 会读取 `language-server/pegjs/test.as`，该文件当前不存在；并且它带 `--trace` 且可能重写生成产物，不是现成自动化测试入口。优先使用 [测试文档](testing.md) 中的只读 smoke test。

## 在 VS Code 中运行插件

1. 在一个窗口打开本仓库，安装依赖并编译。
2. Run and Debug 选择 **Launch Client**。它通过 `--extensionDevelopmentPath` 启动 Extension Development Host。
3. 在新窗口打开游戏项目的 **Script** 目录；多根工作区时每个根应是脚本根，保证相对模块名不冲突。
4. 启动对应 Unreal Editor。检查 `UnrealAngelscript.unrealConnectionPort` 与项目 debug port / `-asdebugport=` 一致。
5. 编辑 `.as` 文件验证功能；避免正式安装版和开发版同时激活造成重复请求/诊断。

LSP 开发调试使用 **Attach to Server**，端口 `6009`，或 **Client + Server** compound。`Launch Client` 与 MainDev 预设都已配置 `preLaunchTask: npm: compile`，F5 会先构建两个 bundle；编译失败时不要选择忽略错误继续运行。

### 本机 MainDev：使用与源码断点

`.vscode/launch.json` 保留通用配置，并提供 **Launch Client (MainDev)** / **Client + Server (MainDev)**：打开 `D:/MainDev/Main/Script`，定位 `Tests/1000_RuntimeTests/TestCase_10_OptionUI.as:34`，加载当前仓库扩展而不是安装版。MainDev 路径是本机预设，其他电脑需调整这两个参数。

开发宿主使用 `%LOCALAPPDATA%/UnrealAngelscriptDev/user-data` 和独立的 `extensions` 目录，不卸载、替换或重启原有窗口里的扩展。此预设仅在这个隔离宿主中禁用 Workspace Trust 提示，限可信的本地脚本目录；不改变原窗口安全设置。不要同时启动多个使用 `6009` 的开发宿主。

本机已通过 CLI 打开的宿主可这样使用：

1. **使用插件**：切到标题含 **[Extension Development Host] [AS Dev]** 的窗口；OptionUI 样例已打开，直接在 `.as` 中用补全/hover，不必再按 F5 启动一个宿主。
2. **调试插件源码**：切到 **vscode-unreal-angelscript** 源码窗口，Ctrl+Shift+D，选择 **Attach to Running Dev Host**，按 F5；它附加 CLI 宿主的扩展进程 `9333` 和语言服务器 `6009`。
3. **打断点**：扩展侧用 `extension/src/extension.ts`，语言侧用 `language-server/src/parsed_completion.ts` 的 `Complete` 或 `server.ts` 的 completion handler；回开发宿主按 Ctrl+Space 触发语言侧断点。已执行过的 `activate` 断点需用户重载开发宿主后才会再次命中。
4. **改代码后生效**：在源码窗口 Ctrl+Shift+B（或 `npm run compile`），随后仅在开发宿主执行 **Developer: Reload Window**，必要时重新附加；不要重载日常工作窗口。修改 PEG 时先重新生成语法。以后没有开发宿主运行时，选择 **Client + Server (MainDev)** 按 F5，即可构建、启动并调试。

等效 CLI 启动命令（PowerShell，在仓库根目录；不附加断点时也能直接使用补全）：

```powershell
npm run compile
code --new-window --extensionDevelopmentPath="$PWD" --user-data-dir="$env:LOCALAPPDATA/UnrealAngelscriptDev/user-data" --extensions-dir="$env:LOCALAPPDATA/UnrealAngelscriptDev/extensions" --inspect-extensions=9333 --disable-workspace-trust "D:/MainDev/Main/Script" --goto "D:/MainDev/Main/Script/Tests/1000_RuntimeTests/TestCase_10_OptionUI.as:34"
```

运行证据可在隔离目录 `user-data/logs/<时间>/window*/exthost/` 查看：`exthost.log` 记录 `Hazelight.unreal-angelscript` 的激活，`output_logging_*/...Angelscript Language Server.log` 显示 Script workspace roots 和 `6009` inspector。本机已确认开发宿主加载本仓库 `language-server/dist/server.js`、两个 inspector 可访问，且该语言服务到现有 Unreal 的 `127.0.0.1:27099` TCP 连接成立；这不代表已实测 UI 补全效果或脚本断点运行。

以上 F5/断点调试的是 **扩展 TypeScript / LSP**，不是 `.as` 在 Unreal 里的执行；后者使用下节的 `angelscript` DAP 配置和 `27099`，本轮没有修改 MainDev 或启动脚本调试会话。

语言服务也可运行：

```sh
node language-server/dist/server.js
```

此时是 **LSP stdio 进程**，需要 LSP 客户端发送 initialize 等协议消息，不是交互式 CLI。不要向 stdout 写普通日志污染协议；新增日志优先用 `connection.console`。

## 调试脚本，而不是调试插件

在游戏 Script 工作区创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "angelscript",
      "request": "launch",
      "name": "Debug Angelscript",
      "hostname": "127.0.0.1",
      "port": 27099,
      "trace": true
    }
  ]
}
```

- `launch` 实际连接已经运行的 Unreal，不负责启动/关闭 Editor。
- `port` 缺省或 ≤0 时使用工作区 `UnrealAngelscript.unrealConnectionPort`。
- `hostname` 只配置 **DAP 的 Unreal 连接**；LSP 主机在 `server.ts` 中固定为 `127.0.0.1`，远程调试不会自动把补全也切过去。
- 扩展设置的端口是 Unreal 端口；`config.debugServer` 由 provider 设置为本地 DAP listener 的端口，不要手动改成 27099。
- 调试工具栏 Stop 停止调试连接；“Resume and Stop PIE”是另一条 `StopPIE` 消息。

## 清单与旧配置的已知差异

- 根 `package.json` 的 debugger `program` 已对齐 `extension/dist/debugAdapter.js`；正常 provider 仍使用 `config.debugServer`，不能把独立 adapter 入口误当成通常运行路径。
- `.vscode/launch.json` 的 **Debug Debug Adapter** 直接指向 `.ts`，且 `debug.ts` 依赖 `vscode` 运行环境，不应视为随便用 Node 即可执行的独立脚本。
- debugger schema 的端口/主机属性使用了 `default:` 键，不是标准 `default`；实际 fallback 以 `ASConfigurationProvider` / `ASDebugSession` 为准。
- tsconfig、TypeScript 与 Node 类型包有版本兼容风险，独立 `tsc --noEmit` 的失败应与 esbuild 打包失败分开记录，不要宣称已有严格类型检查基线。

## 打包与本地分发

在仓库根目录、两个子项目依赖已安装的前提下：

```sh
npm exec --yes --package=@vscode/vsce@3.7.1 -- vsce package --no-dependencies
```

`vscode:prepublish` 自动运行 `npm run compile`，产出根目录下 `unreal-angelscript-<package.json 版本>.vsix`；当前内部版本为 **1.9.5**。下次先按 patch 版本惯例更新根清单版本，再执行同一命令；不要给 `vsce package` 传版本参数，以免隐式触发 npm version/提交。改过 PEG 时仍须先用 Peggy 5.1.0 重生成。

扩展与 LSP 的依赖、PEG parser 和 AST 节点表已由 esbuild 打入 bundle，`--no-dependencies` 不代表漏装运行依赖；接收者不需要 Node/npm、本仓库或开发宿主。`.vscodeignore` 的运行产物白名单只保留清单、README、MIT LICENSE、资源、语言配置/TextMate 语法及 `extension/dist/*.js`、`language-server/dist/*.js`，以及构建时从 languageclient 复制的 Unix 进程清理脚本 `terminateProcess.sh` 和对应许可证，排除本机调试配置、源码/source maps、测试、示例、文档、缓存和 node_modules。不要手改 bundle。

发送 VSIX 文件给同事即可，**无需发布 Marketplace**；可用 PowerShell `Get-FileHash .\unreal-angelscript-1.9.5.vsix -Algorithm SHA256` 校验文件。接收者使用 VS Code **≥1.67.0**（建议当前稳定版），在扩展面板 `…` → **从 VSIX 安装...** 选文件并按提示重载，或运行：

```sh
code --install-extension ./unreal-angelscript-1.9.5.vsix
```

扩展 ID 保持 `Hazelight.unreal-angelscript`，这是内部修改版而非官方市场发布；同 ID 不能并存，安装会替换该配置中的旧版，之后市场更新也可能替换内部版。打开项目 Script 目录，运行兼容 AngelScript debug server 的 Unreal（默认 `27099`）才能获得完整原生 API 提示/脚本调试；async/await 执行能力仍来自项目引擎实现。

验证安装时可用独立目录，避免动到日常工作窗口或已安装扩展：

```powershell
$testRoot = "$env:LOCALAPPDATA/UnrealAngelscriptVsixTest/1.9.5"
code --user-data-dir="$testRoot/user-data" --extensions-dir="$testRoot/extensions" --install-extension ./unreal-angelscript-1.9.5.vsix
code --user-data-dir="$testRoot/user-data" --extensions-dir="$testRoot/extensions" --list-extensions --show-versions
```

此检查证明 VSIX 在本机 Windows x64 可安装及版本正确，不等于完成接收者机器上的 UI/Unreal 联调；包安装不要求重启当前用户窗口，也不会自动修改 MainDev。Linux/macOS 未实测：Windows 打包不保留 Unix helper 的执行位，面向这些平台分发时应在对应平台重跑打包命令并验证退出/重启语言服务。
