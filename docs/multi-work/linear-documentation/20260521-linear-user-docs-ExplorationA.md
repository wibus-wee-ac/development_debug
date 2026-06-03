# Linear 用户文档风格研究 Handoff

研究节点：`ExplorationA`

目标：研究 `https://linear.app/docs` 的用户侧文档信息架构、页面结构、写作口吻、解释方式和可迁移到 Cradle `documentations/` 的规则。本文件只提供规划依据，不实现文档。

## 使用来源

- Linear Docs 首页：<https://linear.app/docs>
- Start Guide：<https://linear.app/docs/start-guide>
- Create issues：<https://linear.app/docs/creating-issues>
- Issue status：<https://linear.app/docs/configuring-workflows>
- Linear Asks：<https://linear.app/docs/linear-asks>
- GitHub：<https://linear.app/docs/github>
- Projects：<https://linear.app/docs/projects>

## Observed IA

Linear 的用户文档不是按内部模块、数据库对象或代码边界组织，而是按用户在产品里会遇到的工作域组织。首页先给出高频入口，再把完整侧栏暴露为稳定的产品地图。

主侧栏分组观察：

- `Getting started`：新用户入口、概念、下载。
- `Account`：账户与身份相关设置。
- `AI`：产品里的 AI 能力。
- `Your sidebar`：个人导航和工作区入口。
- `Teams`：团队、私有团队、子团队、团队页面、状态、triage。
- `Issues`：创建、编辑、分配、批量选择、模板、文档、评论、归档、请求、发布。
- `Issue properties`：状态、优先级、标签、估算、关系等可组合属性。
- `Projects`：项目、里程碑、概览、文档、图表、状态、通知、优先级、依赖、模板、客户请求。
- `Initiatives`、`Cycles`、`Views`、`Find and filter`：规划、周期、视图和检索能力。
- `Linear Asks`：跨 Slack、邮件、表单的请求入口。
- `Integrations`：集成目录和各个第三方系统页。
- `Analytics`：报表与洞察。
- `Administration`：管理、权限、安全、计费或组织级配置。

首页模式：

- 先给 `Popular`，把 `Start Guide`、迁移、Projects、GitHub Automations 这类高频任务放在最前。
- 再给 `Linear basics`，列出工作流、选择 issues、issue relations、display options、triage、parent/sub-issues、notifications、teams。
- 首页不是营销页，而是文档路由器。每张入口卡都有标题和一句具体用途说明。

对 Cradle 的 IA 规则：

- 顶层分组应按用户任务域命名，而不是按 monorepo 包名命名。
- 首页必须提供高频路径：快速开始、桌面端、工作区与会话、agent runtime、providers/models、skills/plugins、approvals、automation、troubleshooting、API/CLI。
- 完整侧栏应覆盖产品使用者、管理员、开发者和运维者，但每个页面要有明确读者，不要混写。
- 集成、插件、自动化这类扩展域应有目录页，然后每个具体能力一页。
- 对拥有生命周期和 namespace 的 Cradle 能力，目录结构要体现 owner。例如插件开发属于 Cradle 插件文档，读取外部 skill namespace 的兼容性说明应放在兼容/迁移段落，不应表现为 Cradle 写入外部 namespace。

## Page Anatomy

Linear 用户页有稳定骨架：

- 全站导航：`Docs`、`Developers`、`Learn`、`Contact support`。
- 左侧侧栏：产品域分组，可折叠，当前组展开。
- 面包屑：显示所属域和当前页。
- `Copy page`：给读者复制当前页面。
- 标题：通常是产品对象或动作名。
- 摘要句：一两句话说明这个功能解决什么问题。
- 首屏图片或产品截图：显示真实 UI 或集成标识。
- `Overview`：先定义对象和边界。
- 任务段落：用动词标题，如创建、配置、查看、添加、删除。
- 细分场景：用三级标题拆开路径，例如邮件创建、复发任务、企业配置、个人账号连接。
- 表格：用于计划层级、集成能力、版本差异、功能支持矩阵。
- `How we work` 或真实示例：说明 Linear 自己如何使用该功能。
- `FAQ`：把例外、失败和限制集中到末尾。
- 前后页导航：提供连续阅读路径。
- 页内目录：由二级和三级标题生成，帮助长页跳转。

对 Cradle 的页面规则：

- 每页标题应是读者会搜索的对象或动作，例如“桌面端工作区”“配置模型提供商”“审批与权限”“插件开发”“Slack bridge”。
- 每页第一段必须回答“这是什么”和“什么时候需要它”。
- 长页要先给 `Overview`，再进入 `Configure`、`Use`、`Troubleshoot` 或 `FAQ`。
- 涉及 UI 的页应优先放真实产品截图或明确的页面路径；没有截图时，至少提供可执行路径和期望结果。
- 涉及集成或运行时能力的页应包含权限、数据流、限制和失败恢复。
- 每页末尾应有下一步链接，避免读者读完后不知道去哪里。

## Tone Guide

Linear 的口吻非常克制，核心特征是短句、任务导向、少营销、少抽象。它默认读者想完成工作，不需要被说服产品有多好。

可迁移规则：

- 用现在时和主动语态。
- 避免大段愿景描述；先说明行为，再说明原因。
- 把推荐做法写成具体动作，不写成原则口号。
- 当功能有前提时，直接写前提，例如计划层级、权限、平台、是否需要管理员。
- 对限制保持坦率，放在读者做决策前能看到的位置。
- 不把内部实现细节暴露给普通用户；只有当它影响配置、数据所有权、兼容性或故障恢复时才解释。
- 页面描述使用一句话，不超过一个概念。
- 对高级读者保持密度：跳过基础概念教学，但给出准确路径、选项、边界和恢复方法。

Cradle 文档正文需要用简体中文，但可以保留 Linear 的节奏：短段落、清晰动作标题、少形容词、每节只解决一个问题。

## Explanation Patterns

### 先定义对象，再给操作

在 issues、projects、statuses 这类页中，Linear 先定义对象归属、必填字段、可选属性或生命周期，再告诉读者如何创建和配置。这样避免步骤看起来像孤立操作。

Cradle 应用：

- 在 “Session” 页先定义 session 与 workspace、agent runtime、messages、tools 的关系，再写如何启动、恢复、等待。
- 在 “Skills” 页先定义 Cradle 读取 skill 的边界和不拥有外部 namespace 的原则，再写如何启用和排错。

### 将复杂入口拆成场景

Linear Asks 把 Slack、Email、Web Forms 分成不同 intake surface，并先解释何时用哪一个。GitHub 页把 GitHub.com、Enterprise Cloud、Enterprise Server 分开比较。

Cradle 应用：

- `providers and models` 应按 local provider、remote provider、per-workspace config、fallback 行为拆开。
- `automation` 应按 trigger、execution、approval、observability 拆开。
- `plugins` 应按安装、启用、权限、数据目录、升级拆开。

### 用表格表达差异

Linear 在计划层级、集成版本、功能支持差异上使用表格。表格只承载决策信息，不承载叙述。

Cradle 应用：

- 对比 desktop app、web workspace、CLI 的能力差异。
- 对比 skills、plugins、tools、MCP servers 的 ownership 和 lifecycle。
- 对比 provider 配置层级：global、workspace、session。

### 把真实工作方式写进文档

Projects 和 issue status 页包含 “How we work” 类型内容，说明 Linear 自己如何使用某功能。这比抽象最佳实践更可信。

Cradle 应用：

- 为 kanban issue agents、automation、Chronicle、Slack bridge 写 “Cradle 推荐工作流” 小节。
- 只写可由当前代码和产品行为验证的实践，不写愿景。

### 在主流程后处理例外

Create issues 先讲常规创建，再讲 email、recurring、URL prefill、drafts，最后 FAQ。GitHub 先讲配置和行为，再讲 linkbacks、autolink、FAQ 和失效恢复。

Cradle 应用：

- 每个配置页先给 happy path，再给权限、兼容性、常见失败。
- 故障处理集中到页末或 `troubleshooting` 分组，不要打断主流程。

### 链接用于继续任务

Linear 的链接多指向下一步、相关功能、外部权威文档或设置路径，不是随意交叉引用。

Cradle 应用：

- 内链必须回答“下一步去哪”。
- 外链只用于外部系统文档、协议或 SDK，不用于替代 Cradle 自己的解释。

## Reusable Page Templates

### Product capability page

适用：desktop app、web workspace、chat runtime、kanban、Chronicle、observability。

结构：

- 标题：功能名。
- 摘要：功能解决的问题。
- `Overview`：对象定义、适用读者、主要边界。
- `Use`：最常见路径。
- `Configure`：只列影响行为的设置。
- `How Cradle uses this`：真实推荐流程。
- `Limits`：当前限制、权限、数据位置。
- `FAQ`：常见问题。
- `Next steps`：相关页面。

### Configuration page

适用：providers/models、approvals、workspace config、git/workspace settings。

结构：

- 标题：配置对象。
- 摘要：配置影响什么。
- `Overview`：配置层级和优先级。
- `Before you start`：权限、环境变量、依赖服务。
- `Configure`：步骤列表。
- `Verify`：如何确认生效。
- `Troubleshoot`：失败症状、可能原因、恢复动作。
- `Reference`：字段、默认值、路径。

### Integration page

适用：Slack bridge、browser-use plugin、system-info plugin、GitHub/workspace integrations。

结构：

- 标题：集成名。
- 摘要：连接哪些系统、同步什么。
- `Overview`：数据流和 ownership。
- `Permissions`：需要的权限和原因。
- `Configure`：安装或启用步骤。
- `Behavior`：同步、触发、状态更新、错误处理。
- `Feature support`：支持矩阵或限制表。
- `FAQ`：常见错误和恢复。

### Developer task page

适用：plugin SDK、server API、generated CLI、database ownership。

结构：

- 标题：开发任务。
- 摘要：开发者完成什么。
- `Overview`：接口边界、owner、兼容策略。
- `Create or change`：最小可运行路径。
- `Test`：命令、fixture、期望结果。
- `Compatibility`：版本、namespace、migration。
- `Reference`：schema、CLI command、route、类型。

### Troubleshooting page

适用：deployment/troubleshooting、observability/devtools、session failures。

结构：

- 标题：症状或故障域。
- 摘要：读者何时使用。
- `Quick checks`：低风险检查。
- `Common causes`：按概率排序。
- `Recovery steps`：可逆优先。
- `Collect diagnostics`：日志、事件、版本、环境。
- `Escalate`：需要维护者或外部系统介入的条件。

## Risks When Adapting To Cradle

- 只模仿视觉而不迁移结构：Linear 风格的核心是任务信息架构和短页面节奏，不是暗色主题或卡片外观。
- 把 monorepo 结构当作文档结构：Cradle 的 `apps/server`、`apps/web`、`packages` 只能作为开发者参考，不应成为用户侧主导航。
- 混合读者：普通用户、管理员、插件作者、运维者需要不同前提。单页同时解释所有层级会破坏 Linear 式清晰度。
- 编造产品行为：Linear 文档大量依赖真实 UI 和真实工作流。Cradle 必须只写代码和产品能验证的能力。
- 忽略 ownership：Cradle 有明确 namespace 原则。文档需要说明读取外部 namespace 与写入 Cradle namespace 的边界。
- 过度教程化：Linear 不做入门语法教学。Cradle 面向高级使用者时，应给精确路径、配置、边界和验证方法。
- 缺少失败恢复：Linear 的集成页会把常见失败放进 FAQ。Cradle 如果只写 happy path，会让复杂 runtime 能力不可运维。
- 链接过密：Linear 的链接大多服务下一步。Cradle 不应把每个内部名词都链接成噪声。

## Concrete Rules For Cradle documentations/

- 首页是入口矩阵，不是营销页。先给 `Popular`，再给核心能力分组。
- 侧栏按任务域组织：入门、工作区、agent runtime、配置、自动化、集成、开发者、运维与故障处理。
- 每个页面都必须有一句摘要，说明读者能完成什么。
- 每个页面都必须有 `Overview`，除非页面本身只是目录索引。
- 操作型页面使用动词标题：配置、启动、连接、查看、恢复、发布。
- 复杂能力必须包含前提、权限、数据位置、限制和验证方法。
- 集成页必须包含 permissions、behavior、feature support 或 limits。
- 开发者页必须说明 owner、namespace、兼容策略和测试方式。
- 页面结尾必须给 `Next steps` 或前后页导航。
- FAQ 只放真实高频问题、限制和恢复步骤，不放二次介绍。
- 中文正文保持短段落；代码块、命令、路径、frontmatter、接口名和标识符保持 English。
- 不复制 Linear 文案；只迁移结构、节奏和解释策略。

## Acceptance Checklist

- [ ] Cradle 文档首页有高频入口和基础能力入口。
- [ ] 侧栏顶层分组能让用户按任务找到页面，而不是按代码目录找页面。
- [ ] 每个核心页面都有标题、摘要、`Overview`、任务段落和下一步。
- [ ] 配置页包含前提、步骤、验证和故障处理。
- [ ] 集成页包含权限、数据流、限制和 FAQ。
- [ ] 开发者页包含 owner、namespace 和兼容性说明。
- [ ] 复杂差异使用表格，不在段落中堆叠条件。
- [ ] 至少部分核心产品页包含 “Cradle 推荐工作流” 或等价真实示例。
- [ ] 所有文档正文使用简体中文，代码、命令、路径和标识符使用 English。
- [ ] 没有复制 Linear 的长段原文；引用只保留来源 URL 和概括性观察。
