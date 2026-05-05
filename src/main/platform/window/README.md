<!-- Once this directory changes, update this README.md -->

# Main/Platform/Window

Window platform bucket 负责主窗口与 tear-off 窗口的显示策略、激活行为与窗口管理。
这些模块被 `app/main` 与 `WindowService` 复用，集中处理窗口生命周期细节。
把窗口层面的策略与 manager 放在这里；业务事件只调用公开 helper。

## Files

- **window-activation.ts**: 控制窗口 reveal/focus 行为，避免测试模式抢占前台
- **window-display-policy.ts**: 根据环境变量判定窗口是否应抑制激活
- **window-manager.ts**: session tear-off 窗口的创建、复用与订阅管理
- **__tests__/**: window platform 回归测试
