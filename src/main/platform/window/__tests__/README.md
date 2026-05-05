<!-- Once this directory changes, update this README.md -->

# Main/Platform/Window/__tests__

这些测试验证窗口 reveal/focus/hide 策略与显示抑制规则。
它们保障平台层窗口行为在主进程重构中保持稳定。
修改窗口激活策略时，应先更新这里。

## Files

- **window-activation.test.ts**: 验证窗口 reveal/focus/hide 的策略与边界行为
- **window-display-policy.test.ts**: 验证环境相关的窗口显示、隐藏与激活抑制判断
