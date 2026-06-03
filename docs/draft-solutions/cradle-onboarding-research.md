# Cradle Onboarding Research

## Direct Conclusion

Cradle 的 onboarding 不应该做成一次性的产品导览，也不应该把 Home 做成“所有能力的橱窗”。更合适的形式是：

1. **以 New Chat 为第一价值路径**：用户第一次打开时，核心问题只有一个：选择项目，然后把一个真实任务交给 agent。
2. **以空状态承载 onboarding**：没有项目、没有 provider、没有历史会话时，不显示控制台式总览，而显示下一步、为什么重要、完成后会得到什么。
3. **用 3-5 步行为 checklist 推动 activation**：每一步必须由真实行为完成，而不是“看过说明”完成。
4. **把高级能力延后到行为触发后揭示**：Automation、Chronicle、Kanban、Skills、Usage 都不应在首屏竞争注意力；等用户完成一次有效 agent run 后，再按上下文浮现。

Cradle 的 onboarding 目标不是“教会所有功能”，而是让用户在 3-5 分钟内形成一个心智模型：

> Cradle = 给本地项目一个可工作的 AI agent 环境；我只要给它项目和任务，它会解释、执行、等待确认、沉淀上下文。

## Evidence From Current Cradle

### Current Entry Points

- `apps/web/src/tabs/home.tab.tsx`：Home 是 pinned tab，标签为 `首页`，因此天然会成为第一次进入的主入口。
- `apps/web/src/tabs/new-chat.tab.tsx`：New Chat 是独立 tab，标签为 `新建聊天`，顶部 `+` 也打开它。
- `apps/web/src/features/workspace/workspace-sidebar.tsx`：项目为空时已经有清晰空状态：`还没有项目` / `添加一个本地仓库开始使用`。
- `apps/web/src/features/new-chat/new-chat-page.tsx`：已经具备 onboarding 所需的核心动作：输入任务、选择 workspace、选择 runtime/profile/model、创建 session、启动第一轮响应。

### Main Friction

当前 Home 更像“已有数据后的工作台”，不是“第一次使用的起点”：

- `apps/web/src/features/home/home-dashboard.tsx` 包含 `需要确认`、`最近活动`、`继续`、`产物`、`快速派发`、`自动化` 等区域。
- 同一文件中存在 `MOCK_PENDING` 和 `MOCK_ARTIFACTS`，会让新用户误以为已有复杂任务、产物、自动化语义。
- `NewChatPage` 虽然是正确入口，但底部同时暴露 runtime、provider/model、thinking、workspace、attachment 等控制，首轮认知负担偏高。

这会造成一个产品感受问题：Cradle 在第一屏展示的是“我有很多能力”，而不是“你现在只需要做第一件事”。

## External Research Principles

外部资料的结论高度一致：

- Appcues checklist guidance 建议先定义 activation goal，再列出新用户到达目标所需的 **3-5 个关键动作**，且 checklist 应基于真实产品行为完成，而不是页面浏览或看完引导完成。Source: https://docs.appcues.com/best-practices/checklist-best-practices
- Appcues flow guidance 明确反对真正意义上的 product tour：新用户不想一上来浏览所有功能，而是要尽快到达首次价值；后续复杂能力应通过 progressive disclosure 在用户准备好后再出现。Source: https://docs.appcues.com/en_US/best-practices/best-practices-for-building-flows-with-appcues
- Appcues 2026 onboarding best practices 强调 value-first quick win、progressive disclosure、contextual tooltips、empty states、cohort-level metrics。Source: https://www.appcues.com/blog/user-onboarding-best-practices
- UserOnboard 对 empty states 的判断更适合 Cradle：空状态不是占位符，而是关键流程的一部分；它应该组织用户动作通往价值。Source: https://www.useronboard.com/onboarding-ux-patterns/empty-states/

对应到 Cradle：不要加全屏 tour；先重排第一次使用路径。

## Proposed Activation Definition

### Activation Event

建议把 Cradle 的 activation 定义为：

> 用户在一个本地 workspace 中成功启动第一条 agent session，并看到 agent 产生与该 workspace 相关的有效进展。

这比“添加 workspace”更准确，因为添加项目只是准备动作；也比“发出第一条消息”更准确，因为空泛聊天不能证明 Cradle 的产品价值。

### Core Activation Funnel

1. `workspace_added`
2. `provider_or_agent_ready`
3. `first_task_prompt_submitted`
4. `first_agent_progress_visible`
5. `first_user_confirms_or_continues`

第 4 步是 aha moment：用户看到 agent 真的在读项目、运行工具、解释进度，而不是普通聊天。

## Recommended Onboarding Shape

### 1. First-Run Home Should Be a Focused Start Screen

当满足以下条件时，Home 不显示 dashboard：

- `workspaces.length === 0`
- 或没有可用 provider profile / CLI TUI agent
- 或没有任何 session

改为显示一个 compact start surface：

- 主标题：`Start with a real project`
- 主 CTA：`Add project`
- 次 CTA：`Configure model`
- 第三入口：`Try with existing agent`，仅当 CLI TUI agent 可用时显示
- 一段非常短的说明：Cradle 会围绕本地项目创建 agent session。

避免展示 Automation、Artifacts、Pending runs、Usage 等高级概念。

### 2. New Chat Should Have Beginner and Advanced Disclosure

`NewChatPage` 应保持为第一价值路径，但默认状态要降噪：

- 默认只展示 textarea、workspace、send。
- provider/model/runtime/thinking 收进一个 `Agent` 控制里，默认显示当前可用配置。
- 如果没有 provider/profile，则在 composer 内联显示 blocking setup row，而不是让 send button 只是 disabled。
- quick actions 改成 Cradle 的真实首轮任务模板：
  - `Explain this codebase`
  - `Find risky changes`
  - `Fix a failing test`
  - `Write project notes`
  - `Plan a refactor`

这些 prompt 必须绑定 workspace 语境，避免变成通用 ChatGPT 首页。

### 3. Checklist Should Be Small and Behavior-Based

推荐 checklist 只保留 4 项：

| Step | Completion Event | User Value |
| --- | --- | --- |
| Add a project | Workspace created from local directory | Cradle knows where work happens |
| Choose an agent runtime | Provider profile exists or CLI TUI agent available | User can actually run a task |
| Start the first task | Session created with workspace-bound prompt | User sees the product do work |
| Review the result | User sends follow-up, approves, or opens produced context | User learns the collaboration loop |

不要把 `Open settings`、`Watch video`、`Read docs` 放进 checklist；那些是支持行为，不是 activation 行为。

### 4. Empty States Need One Next Action

当前空状态可以保留设计语气，但应更一致：

- Workspace empty：只引导添加本地项目。
- Session empty：引导开始 workspace-bound task，不显示“暂无最近会话”这种死状态。
- Provider empty：解释“需要一个模型服务才能运行标准 agent”，直接跳到 `Settings > 模型服务`。
- Automation empty：只在用户完成首轮 agent run 后出现，文案从 `No automations` 改为“把重复任务交给 agent 定期执行”。
- Usage empty：只在有 session 后出现，否则 usage 对新用户没有意义。

空状态文案结构统一为：

1. What is missing
2. Why it matters
3. One action
4. Optional preview of the result

### 5. Advanced Features Should Unlock by Milestone

建议用“行为里程碑”决定功能显露，而不是固定时间：

| Milestone | Reveal |
| --- | --- |
| First workspace added | Show file/context affordances |
| First agent run started | Show progress/tool-call education inline |
| First run completed | Show follow-up suggestions and approvals |
| 2-3 sessions in same workspace | Show workspace detail, rules, pack codebase |
| Repeated prompt pattern detected | Suggest automation |
| User asks about memory/search | Suggest Chronicle |

这符合 Cradle 的长期复杂度：能力仍然完整存在，但不会在第一分钟抢注意力。

## Concrete UI Proposal

### First-Run Home Layout

Use current design language: two-tone chrome, compact typography, no marketing hero, no large illustrations.

```text
┌──────────────────────────────────────────────────────────────┐
│ Start with a real project                                    │
│ Cradle works best when an agent can see your local codebase. │
│                                                              │
│ [Add project]  [Configure model]                             │
│                                                              │
│ Setup                                                        │
│ ✓ Desktop ready                                              │
│ ○ Project added                                              │
│ ○ Agent runtime ready                                        │
│ ○ First task started                                         │
└──────────────────────────────────────────────────────────────┘
```

首屏只回答“下一步做什么”。不要展示 mock artifacts 或 pending approvals。

### New Chat Beginner State

```text
┌──────────────────────────────────────────────────────────────┐
│ Describe the task you want the agent to do in this project...│
│                                                              │
│ Explain this codebase  Find risky changes  Fix failing test  │
│                                                              │
│ Agent: Claude Sonnet · Project: Cradle                    ↑  │
└──────────────────────────────────────────────────────────────┘
```

Advanced controls can live behind the Agent menu:

- runtime
- provider profile
- model
- thinking effort
- CLI TUI agent

### Completion State

After first successful task:

```text
First task started

Cradle is now reading your project and showing its work. You can:
[Ask a follow-up] [Open workspace context] [Create a repeatable task]
```

This is the moment to introduce follow-up behavior, not before.

## Implementation Ownership

Keep onboarding owned by the feature that owns the user moment:

- `features/home`: first-run home projection and dashboard gating.
- `features/new-chat`: first-task path, beginner composer disclosure, prompt templates.
- `features/workspace`: workspace empty state and project-add CTA.
- `features/agent-management` / `features/settings`: provider/runtime readiness setup.
- `features/automation`, `features/chronicle`, `features/usage`: post-activation contextual empty states.

Avoid a global `features/onboarding` that writes state into other domains. A small `onboarding-progress` helper can read events/state and project progress, but each feature should own its own UI and lifecycle.

## Metrics

Minimum useful telemetry:

- `onboarding_home_seen`
- `workspace_add_started`
- `workspace_added`
- `agent_runtime_ready`
- `new_chat_prompt_template_selected`
- `first_task_prompt_submitted`
- `first_agent_progress_visible`
- `first_agent_run_completed`
- `first_followup_submitted`

Primary metrics:

- activation rate: users reaching `first_agent_progress_visible`
- time-to-first-task
- first-session completion rate
- D1/D7 return with same workspace

Do not optimize for checklist completion alone; it can become a vanity metric if it does not correlate with repeated agent usage.

## Phased Plan

### Phase 1: Low-Risk Product Alignment

1. Gate `HomeDashboard` into first-run mode when there are no workspaces or sessions.
2. Remove mock pending/artifact content from first-run view.
3. Add readiness messages for missing workspace and missing agent runtime.
4. Rewrite New Chat quick actions to be workspace-bound developer tasks.

### Phase 2: Progressive Disclosure

1. Collapse advanced New Chat controls behind a single Agent control for new users.
2. Add behavior-based checklist projection.
3. Add contextual empty states for sessions, providers, automation, and usage.

### Phase 3: Measurement and Iteration

1. Add activation events.
2. Compare cohorts before and after first-run Home changes.
3. Use successful first-run prompts to refine default templates.
4. Only then consider optional guided tips.

## Risks

- Over-hiding controls may frustrate power users. Mitigation: always keep advanced controls one click away and preserve persisted preferences.
- Checklist can become busywork. Mitigation: only check off real product actions.
- First-run mode may conflict with existing pinned Home expectations. Mitigation: switch to dashboard automatically once the user has sessions or dismisses the start surface.
- Provider setup can be the longest pole. Mitigation: if CLI TUI agents are available, allow that path to become the first value route.

## Recommended Next Step

Implement Phase 1 first. It targets the actual current issue: Cradle's first screen communicates breadth before usefulness. The smallest meaningful product change is to make Home context-sensitive:

- Empty/no-session state: first-run start screen.
- Activated state: current dashboard.

That keeps the existing architecture intact while making the product feel easier immediately.

