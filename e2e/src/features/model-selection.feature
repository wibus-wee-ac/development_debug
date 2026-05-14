# language: zh-CN
@cradle @P0
功能: 模型与 Agent 选择

  作为用户
  我希望在发送消息前选择 Agent 和模型

  背景:
    假如 应用已启动
    而且 我已配置 Mock LLM Provider

  @CRADLE-MODEL-001
  场景: 新会话页面选择 Agent
    当 我进入新会话页面
    而且 我打开 Agent 选择器
    那么 应该看到可用的 Agent 列表

  @CRADLE-MODEL-002
  场景: 选择 Agent 后发送消息使用该 Agent
    当 我进入新会话页面
    而且 我选择 Mock LLM Agent
    而且 我发送消息"你好"
    那么 应该收到 Agent 的回复
