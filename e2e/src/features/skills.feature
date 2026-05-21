# language: zh-CN

@cradle
功能: Skills 管理

  作为用户，我可以通过真实 UI 管理全局、工作区与 Agent 专属 Skills

  @P1 @CRADLE-SKILLS-001
  场景: 导航到全局 Skills 设置页面
    当 我点击设置按钮
    而且 我点击"Skills"导航项
    那么 我应该看到全局 Skills 页面

  @P1 @CRADLE-SKILLS-002
  场景: 在全局 Skills 页面创建 Skill
    假如 我已进入全局 Skills 页面
    当 我新建一个全局 Skill
    那么 我应该看到全局 Skill "global-demo"
    当 我打开 Skill "global-demo"
    那么 当前 Skill 详情应显示描述为 "Global demo skill"
    而且 当前 Skill 详情应显示内容为:
      """
      # Global Demo

      Use this skill carefully.
      """

  @P1 @CRADLE-SKILLS-003
  场景: 导入全局 Skill 后可以查看详情
    假如 我已进入全局 Skills 页面
    而且 我准备了一个待导入的 Skill 目录
    当 我导入这个全局 Skill
    那么 我应该看到全局 Skill "imported-demo"
    当 我打开 Skill "imported-demo"
    那么 当前 Skill 详情应显示描述为 "Imported demo skill"
    而且 当前 Skill 详情应显示内容为:
      """
      # Imported Demo
      """

  @P1 @CRADLE-SKILLS-004
  场景: 在工作区详情页创建 Workspace Skill
    假如 我已打开一个工作区详情页
    当 我切换到 Workspace Skills 标签
    而且 我新建一个工作区 Skill
    那么 我应该看到工作区 Skill "workspace-demo"
    当 我打开 Skill "workspace-demo"
    那么 当前 Skill 详情应显示描述为 "Workspace demo skill"
    而且 当前 Skill 详情应显示内容为:
      """
      # Workspace Demo

      Scoped to one repo.
      """

  @P1 @CRADLE-SKILLS-005
  场景: 通过真实 Settings UI 为 Agent 创建专属 Skill
    假如 我已通过真实 Settings UI 创建一个 Agent "Skill Keeper"
    当 我打开 Agent "Skill Keeper" 的 Skills 管理
    而且 我新建一个 Agent Skill
    那么 我应该看到 Agent Skills 页面
    而且 我应该看到 Agent Skill "agent-demo"
    当 我打开 Skill "agent-demo"
    那么 当前 Skill 详情应显示描述为 "Agent demo skill"
    而且 当前 Skill 详情应显示内容为:
      """
      # Agent Demo

      Private to one agent.
      """

  @P1 @CRADLE-SKILLS-006
  场景: 在全局 Skills 页面编辑并删除 Skill
    假如 我已进入全局 Skills 页面
    而且 我新建一个全局 Skill
    当 我打开 Skill "global-demo"
    而且 我编辑当前 Skill 名称为 "global-demo-updated"
    而且 我编辑当前 Skill 描述为 "Global demo skill updated"
    而且 我编辑当前 Skill 内容为:
      """
      # Global Demo Updated

      Keep this global skill current.
      """
    而且 我保存当前 Skill
    那么 我应该看到全局 Skill "global-demo-updated"
    当 我打开 Skill "global-demo-updated"
    那么 当前 Skill 详情应显示描述为 "Global demo skill updated"
    而且 当前 Skill 详情应显示内容为:
      """
      # Global Demo Updated

      Keep this global skill current.
      """
    而且 我不应该看到 Skill "global-demo"
    当 我删除当前 Skill
    那么 我不应该看到 Skill "global-demo-updated"

  @P1 @CRADLE-SKILLS-007
  场景: 在工作区 Skills 页面编辑并删除 Skill
    假如 我已打开一个工作区详情页
    当 我切换到 Workspace Skills 标签
    而且 我新建一个工作区 Skill
    而且 我打开 Skill "workspace-demo"
    而且 我编辑当前 Skill 名称为 "workspace-demo-updated"
    而且 我编辑当前 Skill 描述为 "Workspace demo skill updated"
    而且 我编辑当前 Skill 内容为:
      """
      # Workspace Demo Updated

      Repository-specific instructions only.
      """
    而且 我保存当前 Skill
    那么 我应该看到工作区 Skill "workspace-demo-updated"
    当 我打开 Skill "workspace-demo-updated"
    那么 当前 Skill 详情应显示描述为 "Workspace demo skill updated"
    而且 当前 Skill 详情应显示内容为:
      """
      # Workspace Demo Updated

      Repository-specific instructions only.
      """
    而且 我不应该看到 Skill "workspace-demo"
    当 我删除当前 Skill
    那么 我不应该看到 Skill "workspace-demo-updated"

  @P1 @CRADLE-SKILLS-008
  场景: 通过真实 Settings UI 编辑并删除 Agent 专属 Skill
    假如 我已通过真实 Settings UI 创建一个 Agent "Skill Editor"
    当 我打开 Agent "Skill Editor" 的 Skills 管理
    而且 我新建一个 Agent Skill
    而且 我打开 Skill "agent-demo"
    而且 我编辑当前 Skill 名称为 "agent-demo-updated"
    而且 我编辑当前 Skill 描述为 "Agent demo skill updated"
    而且 我编辑当前 Skill 内容为:
      """
      # Agent Demo Updated

      Only Skill Editor should read this.
      """
    而且 我保存当前 Skill
    那么 我应该看到 Agent Skill "agent-demo-updated"
    当 我打开 Skill "agent-demo-updated"
    那么 当前 Skill 详情应显示描述为 "Agent demo skill updated"
    而且 当前 Skill 详情应显示内容为:
      """
      # Agent Demo Updated

      Only Skill Editor should read this.
      """
    而且 我不应该看到 Skill "agent-demo"
    当 我删除当前 Skill
    那么 我不应该看到 Skill "agent-demo-updated"
