<!-- Once this directory changes, update this README.md -->

# Main/Devtools/__tests__

这些测试验证 devtool 缓冲、订阅与窗口后端集成。
它们保障观测能力不会因业务重构而静悄悄失灵。
修改 devtool store contract 时，应优先更新这里。

## Files

- **acp-devtool-store.test.ts**: 验证 ACP devtool store 的记录、截断与订阅行为
- **ipc-devtool-backend.test.ts**: 验证 IPC devtool backend 的缓冲与窗口集成
