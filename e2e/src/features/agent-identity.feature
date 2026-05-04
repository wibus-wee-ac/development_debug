# language: zh-CN
@cradle @P1 @CRADLE-AGENT-IDENTITY-001
功能: Agent Identity 管理

  作为用户，我可以在设置中创建、编辑和删除具有独立身份的 Agent

  场景: 导航到 Agent 设置页面
    当 我点击设置按钮
    而且 我点击"Agents"导航项
    那么 我应该看到 Agent 列表页面

  @CRADLE-AGENT-IDENTITY-002
  场景: Agent 列表页面显示空状态
    假如 我已进入 Agent 列表页面
    那么 我应该看到 Agent 空状态提示

  @CRADLE-AGENT-IDENTITY-003
  场景: 点击新建 Agent 按钮进入创建页面
    假如 我已进入 Agent 列表页面
    当 我点击"New Agent"按钮
    那么 我应该看到 Agent 创建页面

  @CRADLE-AGENT-IDENTITY-004
  场景: Agent 创建页面显示头像预览
    假如 我已进入 Agent 列表页面
    而且 我已打开 Agent 创建页面
    那么 我应该看到 DiceBear 头像预览
