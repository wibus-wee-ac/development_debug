<!-- Once this directory changes, update this README.md -->

# Main/Platform/Window

Window platform bucket 负责主窗口与 tear-off 窗口的显示策略、激活行为与窗口管理。
这些模块被 `app/main` 与 `WindowService` 复用，集中处理窗口生命周期细节。
把窗口层面的策略与 manager 放在这里；业务事件只调用公开 helper。

## Files

- **window-activation.ts**: 控制窗口 reveal/focus/hide 行为，避免测试模式抢占前台或弹窗打扰
- **window-display-policy.ts**: 根据环境变量判定窗口应显示、后台显示还是保持隐藏
- **window-manager.ts**: session tear-off 窗口的创建与复用；窗口只注册 unified signal bridge，不再直接接触 ChatEngine
- **__tests__/**: window platform 回归测试
