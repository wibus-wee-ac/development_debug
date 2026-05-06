# language: zh-CN
@cradle @P1 @CRADLE-PROVIDER-001
功能: Codex 和 Claude Agent 提供者
  作为用户，我希望能够配置和使用 Codex 和 Claude Agent 提供者进行聊天

  背景:
    假如 应用已启动

  @CRADLE-PROVIDER-002
  场景: 可以通过 IPC 注册 Codex provider profile
    当 我通过 IPC 创建一个 Codex provider profile
    那么 该 profile 应出现在 profile 列表中
    而且 该 profile 的 providerKind 应为"codex"

  @CRADLE-PROVIDER-003
  场景: 可以通过 IPC 注册 Claude Agent provider profile
    当 我通过 IPC 创建一个 Claude Agent provider profile
    那么 该 profile 应出现在 profile 列表中
    而且 该 profile 的 providerKind 应为"claude-agent"

  @CRADLE-PROVIDER-004
  场景: Codex provider profile 可以获取模型列表
    假如 我已配置指向 Mock 服务的 Codex provider profile
    当 我请求该 profile 的模型列表
    那么 模型列表应包含至少一个模型

  @CRADLE-PROVIDER-005
  场景: Claude Agent provider profile 可以获取模型列表
    假如 我已配置指向 Mock 服务的 Claude Agent provider profile
    当 我请求该 profile 的模型列表
    那么 模型列表应包含至少一个模型

  @CRADLE-PROVIDER-006
  场景: Mock LLM 支持工具调用流式响应
    假如 我已配置带工具调用的 Mock LLM Provider
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天页面
    当 我在新建聊天输入框中输入"请调用工具"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天状态最终应为"idle"
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"

  @CRADLE-PROVIDER-007
  场景: provider profile 探测成功
    假如 我已配置指向 Mock 服务的 Codex provider profile
    当 我探测该 profile
    那么 探测结果应为成功

  @CRADLE-PROVIDER-008
  场景: 通过 UI 添加 Codex provider 并探测成功
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"Codex"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"codex-mini-latest"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功

  @CRADLE-PROVIDER-009
  场景: 通过 UI 添加 Claude Agent provider 并探测成功
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"Claude Agent"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"claude-sonnet-4-20250514"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
