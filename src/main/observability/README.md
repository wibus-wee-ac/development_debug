<!-- Once this directory changes, update this README.md -->

# Main/Observability

本目录是 Cradle 本地可观测能力的 owner namespace。
目标是提供小而硬的观测闭环：canonical 事件模型、非阻塞持久化、少量高价值规则、以及调试导出。
这里不做“通用平台化日志系统”，也不允许链式转换函数泛滥。

## Files

- **contract.ts**: canonical event/incident contract、事件 code 常量、dedupe key helper
- **sink.ts**: 轻量 observability sink 端口（DI 边界）与 noop 默认实现
- **store.ts**: 内存队列 + 后台批量写 SQLite 的持久化存储层
- **rules.ts**: 纯函数 incident 规则（仅保留高价值规则）
- **exporter.ts**: 导出事件、incident 与关联 timeline 的调试包
- **service.ts**: 观测服务编排（record/query/flush/export）与 singleton lifecycle
