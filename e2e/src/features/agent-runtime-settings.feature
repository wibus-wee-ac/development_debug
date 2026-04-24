# language: zh-CN
@cradle @P1 @CRADLE-AGENT-RUNTIME-001
功能: Agent Runtime 管理

  作为用户，我可以在设置中统一管理不同 Provider 的 Agent Profile

  场景: 导航到 Agent Runtime 设置页面
    当 我点击设置按钮
    而且 我点击"Agents"导航项
    那么 我应该看到 Agent Runtime 设置页面

  @CRADLE-AGENT-RUNTIME-002
  场景: Agent Runtime 设置页面显示 Provider 类型选择
    假如 我已进入 Agent Runtime 设置页面
    那么 我应该看到 Provider 类型选择

  @CRADLE-AGENT-RUNTIME-003
  场景: Agent Runtime 设置页面显示 Profile 列表或空状态
    假如 我已进入 Agent Runtime 设置页面
    那么 我应该看到 Agent Profile 列表或空状态
