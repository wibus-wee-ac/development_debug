<!-- Once this directory changes, update this README.md -->

# Main/Events/Tests

事件总线与领域事件定义的单元测试位于此目录。
测试验证事件发布、订阅、取消订阅和异步处理顺序等行为契约。
新增事件管线能力时，优先在这里补行为测试再实现。

## Files

- **domain-event-bus.test.ts**: 事件总线订阅、发布与取消订阅的行为测试
