<!-- Once this directory changes, update this README.md -->

# Main/Events

主进程事件层负责定义领域事件与进程内事件管线。
它为应用层提供显式 publish/subscribe 边界，减少跨域直接耦合。
新增跨模块生命周期联动时，优先通过这里扩展事件模型。

## Files

- **chat-turn-finished-bridge.ts**: 把 ChatEngine turn finished 生命周期桥接到 `chat.turn-finished` 领域事件
- **domain-event-bus.ts**: 进程内领域事件总线实现，提供订阅与发布能力
- **domain-events.ts**: 领域事件类型定义，当前包含 chat turn 完成事件
