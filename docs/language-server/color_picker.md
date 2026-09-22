# color_picker.ts：颜色预览和编辑

源码：[language-server/src/color_picker.ts](../../language-server/src/color_picker.ts)。入口 `ProvideDocumentColors` / `ProvideColorPresentations`，由 server 注册标准 LSP color 能力。

## 数据链

`database.FinishTypesFromUnreal` 给 FLinearColor 构造方法标记 `IsLinearColor`，给 `FLinearColor::MakeFromHex` 标记 `IsHexColor`。parser 检测调用后收集 `ASModule.annotatedFunctionCalls`，本模块只扫描这批注解，不靠全文匹配函数名。

- LinearColor：参数通过 `GetConstantNumberFromNode` 提取常量，RGB 不足补 0，未提供 alpha 时为 1；非纯常量不展示该预览。
- HexColor：按 `0xAARRGGBB` 拆通道映射到 0～1；无法取值时有默认值路径，不能承诺所有动态表达式准确反映颜色。
- 修改时，线性颜色输出 FLinearColor(...)、通道保留两位小数；hex 输出对应整数文本，并依据范围处理右括号。

## 扩展

新增颜色工厂要先给 DBMethod 加注解，确保 parser 收集，再增加读取和回写分支；仅修改函数名称列表不够。

明确 sRGB/linear、通道顺序、alpha 缺省、HDR 值范围和文本替换区间。当前代码直接读写数值，没有完整色彩空间转换层。

测试负数/浮点/hex 常量、动态参数、三/四通道、空参数、只替换参数与替换完整构造式两种范围。相关：[database](database.md)、[as_parser](as_parser.md)。
