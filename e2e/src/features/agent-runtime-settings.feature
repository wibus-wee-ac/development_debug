# language: zh-CN
@cradle @P1 @CRADLE-AGENT-RUNTIME-001
功能: Agent Runtime 管理

  作为用户，我可以在设置中统一管理不同 Provider 的 Agent Profile

  场景: 导航到 Provider 设置页面
    当 我点击设置按钮
    而且 我点击"Providers"导航项
    那么 我应该看到 Agent Runtime 设置页面

  @CRADLE-AGENT-RUNTIME-002
  场景: Agent Runtime 设置页面显示 Provider 类型选择
    假如 我已进入 Agent Runtime 设置页面
    那么 我应该看到 Provider 类型选择

  @CRADLE-AGENT-RUNTIME-003
  场景: Agent Runtime 设置页面显示 Profile 列表或空状态
    假如 我已进入 Agent Runtime 设置页面
    那么 我应该看到 Agent Profile 列表或空状态

  @CRADLE-AGENT-RUNTIME-004
  场景: 通过 UI 创建 OpenAI-compatible profile 并持久化
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"OpenAI Mock"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"mock-model"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
    而且 Provider 列表中应显示名为"OpenAI Mock"的 profile
    而且 数据库中应持久化名为"OpenAI Mock"、类型为"openai-compatible"、模型为"mock-model"的 Provider

  @CRADLE-AGENT-RUNTIME-005
  场景: Provider 探测失败时显示错误状态并保持对话框打开
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"Broken OpenAI"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为失败并提示"API key credential is required"
    而且 Provider 对话框应保持打开

  @CRADLE-AGENT-RUNTIME-006
  场景: 编辑已有 OpenAI-compatible profile
    假如 我已有一个名为"Legacy OpenAI"、Base URL 为"https://legacy.example/v1"、模型为"gpt-4o-mini"、启用状态为"启用"的 OpenAI-compatible Provider
    而且 我已进入 Agent Runtime 设置页面
    当 我打开名为"Legacy OpenAI"的 Provider
    而且 我编辑 Provider Name 为"Updated OpenAI"
    而且 我编辑 Provider Base URL 为"https://updated.example/v1"
    而且 我编辑 Provider Model 为"gpt-4.1-mini"
    而且 我编辑 Provider API Key 为"updated-key"
    而且 我保存 Provider 编辑
    那么 Provider 列表中应显示名为"Updated OpenAI"、模型为"gpt-4.1-mini"的 profile
    而且 数据库中应持久化名为"Updated OpenAI"、Base URL 为"https://updated.example/v1"、模型为"gpt-4.1-mini"、启用状态为"启用"的 Provider

  @CRADLE-AGENT-RUNTIME-007
  场景: 删除已有 profile
    假如 我已有一个名为"Disposable Provider"、Base URL 为"https://delete.example/v1"、模型为"gpt-4o-mini"、启用状态为"启用"的 OpenAI-compatible Provider
    而且 我已进入 Agent Runtime 设置页面
    当 我移除名为"Disposable Provider"的 Provider
    那么 Provider 列表中不应显示名为"Disposable Provider"的 profile
    而且 数据库中不应存在名为"Disposable Provider"的 Provider

  @CRADLE-AGENT-RUNTIME-008
  场景: 切换 profile 启用状态
    假如 我已有一个名为"Switchable Provider"、Base URL 为"https://toggle.example/v1"、模型为"gpt-4o-mini"、启用状态为"启用"的 OpenAI-compatible Provider
    而且 我已进入 Agent Runtime 设置页面
    当 我切换名为"Switchable Provider"的 Provider 启用状态
    那么 名为"Switchable Provider"的 Provider 应处于"禁用"状态
    而且 数据库中名为"Switchable Provider"的 Provider 应处于"禁用"状态
    当 我切换名为"Switchable Provider"的 Provider 启用状态
    那么 名为"Switchable Provider"的 Provider 应处于"启用"状态
    而且 数据库中名为"Switchable Provider"的 Provider 应处于"启用"状态
