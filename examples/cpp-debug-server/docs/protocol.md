 # protocol.h：示例线协议

源码：[src/protocol.h](../src/protocol.h)。这里只编码基础字段和帧，不处理 DAP，不持有 socket。

- enum 显式固定为现有 `unreal-debugclient.ts` 的消息编号；示例只列使用的项。
- Writer 的 integer 为 int32 LE；boolean 也是四字节 integer。
- Writer.string 输出正长度 UTF-8，长度按字节计算，含最终 NUL。
- Reader 按边界检查后读取字段；不够长则抛异常，由 server 关闭单个坏连接。
- 当前 TS 客户端写入 Latin-1/binary；示例要求请求路径/表达式使用 ASCII，不实现 UTF-16 请求。

## 两个方向的 length

```text
TS → C++：uint32(1 + payload.size) + byte(type) + payload
C++ → TS：uint32(payload.size)     + byte(type) + payload
```

这是为兼容当前仓库收/发实现而采用的非对称格式。`serverFrame` 只构造第二种；第一种由 main.cpp 的 receiveMessages 拆包。最大帧限制为 64KiB。

不要直接 serialize C++ struct：padding、bool 大小、端序都可能不同。不要未经两端核对就统一 length；特别是无 payload 消息，两个方向分别写 1 和 0。

完整字段表：[仓库协议文档](../../../docs/guides/debug-server.md)。

## 扩展/验证

新消息先核对 C++ enum、两份 TS enum 与协议版本，再添加读取和回复；当前示例 serverVersion=1，没有数据断点地址字段。

TCP 测试覆盖分片头部、多帧合并、非法 length、截断字符串与单连接失败隔离。它验证示例兼容当前客户端，不代表与所有 Unreal 版本互通。
