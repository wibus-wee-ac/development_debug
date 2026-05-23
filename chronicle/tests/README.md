# Chronicle Tests

Cradle Chronicle 的集成测试目录。

## Files

- `smoke.rs`: 运行已编译的 `cradle-chronicle` binary，并验证真实 artifact、memory output、`events.ndjson` 和 `memory-manifest.json`。测试显式把 `CRADLE_URL` 指向不可达地址，证明 smoke core path 不依赖 Server。
