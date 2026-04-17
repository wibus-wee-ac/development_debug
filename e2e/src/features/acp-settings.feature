# language: zh-CN
@cradle @P1 @CRADLE-ACP-001
功能: ACP 代理管理

  作为用户，我可以在设置中浏览、管理 ACP 代理

  场景: 导航到 ACP 设置页面
    当 我点击设置按钮
    而且 我点击"代理 (ACP)"导航项
    那么 我应该看到 ACP 设置页面

  @CRADLE-ACP-002
  场景: ACP 设置页面显示搜索框
    假如 我已进入 ACP 设置页面
    那么 我应该看到搜索框

  @CRADLE-ACP-003
  场景: ACP 注册表加载完成后显示代理列表
    假如 我已进入 ACP 设置页面
    那么 我应该看到代理列表或空状态
