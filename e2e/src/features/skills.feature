# language: zh-CN
@cradle @P1 @CRADLE-SKILLS-001
功能: Skills 管理

  作为用户，我可以管理全局与工作区 Skills，并在 Agent 中选择可用技能

  场景: 导航到全局 Skills 设置页面
    当 我点击设置按钮
    而且 我点击"Skills"导航项
    那么 我应该看到全局 Skills 页面

  @CRADLE-SKILLS-002
  场景: 在全局 Skills 页面创建 Skill
    假如 我已进入全局 Skills 页面
    当 我新建一个全局 Skill
    那么 我应该看到全局 Skill "global-demo"
    而且 全局 Skill "global-demo" 应该写入磁盘

  @CRADLE-SKILLS-003
  场景: 导入并导出全局 Skill
    假如 我已进入全局 Skills 页面
    而且 我准备了一个待导入的 Skill 目录
    当 我导入这个全局 Skill
    而且 我导出全局 Skill "imported-demo"
    那么 导出的 Skill 包应该保留 SKILL.md

  @CRADLE-SKILLS-004
  场景: 在工作区详情页创建 Workspace Skill
    假如 我已打开一个工作区详情页
    当 我切换到 Workspace Skills 标签
    而且 我新建一个工作区 Skill
    那么 我应该看到工作区 Skill "workspace-demo"
    而且 Workspace Skill "workspace-demo" 应该写入磁盘

  @CRADLE-SKILLS-005
  场景: Agent 创建表单显示 Skills 选择区
    假如 我已进入 Agent 列表页面
    而且 我已创建一个全局 Skill
    而且 我已打开 Agent 创建表单
    那么 我应该看到 Agent Skills 配置
    而且 我应该看到 Skill 选项 "global-demo"
