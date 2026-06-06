# Linear Diffs Source Research

本文记录 2026-06-06 对 Linear Diffs / Reviews 的外部资料调研结果。它只作为 Cradle 设计输入，不把 Linear 的具体实现当作必须复制的架构。

## Sources

- `https://linear.app/docs/diffs`: Linear Docs 的 Reviews 页面，页面 canonical title 为 `Reviews - Linear Docs`。
- `https://linear.app/changelog/2026-05-27-linear-diffs`: Linear Diffs 发布 changelog，页面显示发布日期为 `May 28, 2026`。
- `https://linear.app/diffs`: Linear Diffs 产品页，metadata 为 `Review code faster`。
- `https://linear.app/docs/github#pull-request-preview-links`: GitHub integration 中的 pull request preview links 入口，被 Reviews 文档引用。

## Verified Linear Behaviors

### Product Surface

- Linear 把 Diffs 定位为一个 code review experience，而不是单纯的 patch viewer。
- Pull request review 可以在 Linear 内查看、评论、审批，并与 GitHub 双向同步。
- 启用后 Linear 显示 pull request details、changed files、checks、comments。
- Diff 直接连接到 Linear issue，强调 issue context、agent work context、review context 处于同一个 surface。
- Linear sidebar 会出现 Reviews section，用于查看需要关注的 PR、自己创建的 PR，以及自己参与过的 reviews。
- Reviews tab 顶部有两个主要视图：需要关注/参与/负责的 PR，以及自己 authored 的 PR。
- Reviews 视图可以按 status、author、repository 分组或排序，也可以选择显示 draft / closed PR，并显示 repository、failed checks、preview links 等额外字段。
- Linear 支持从 GitHub PR URL 进入 Linear review URL：把 `github.com/owner/repo/pull/123` 替换为 `linear.review/owner/repo/pull/123`。

### Enablement And Access

- Linear 要显示 pull request diffs 和 file changes，需要通过 GitHub integration 授予 repository code access。
- 如果 workspace 尚未连接 GitHub，需要 Linear owner 或 admin 配置 GitHub integration 并为所选 repositories 启用 code access。
- 如果 workspace 已连接 GitHub，需要 GitHub organization owner 在 GitHub Integration settings 更新 integration 权限。
- 启用 code access 会保留当前 GitHub integration settings、既有 PR links 和 history，只是增加展示 diffs/file contents 所需权限。
- 个人 GitHub connection 是访问与具体用户相关的 pull requests、repository code、review information 的前提。
- 如果看不到 Reviews tab，Linear 文档建议去 sidebar customization 启用 code reviews；如果有 Reviews tab 但没有 diffs，需要确认目标 repository 已授予 code access。

### Review Interaction

- Linear 支持 Unified 和 Split diff view。
- Split view 在窄屏或横向空间不足时可能不可用。
- Linear 文档给出快捷键：`Ctrl` 或 `Cmd` + `B` 切换 Unified / Split。
- Review comments、approvals、PR status 与 GitHub 同步。
- Pull request activity、comments、reviews、discussions 聚合在一个 review 页面。
- Inline comments 出现在相关代码旁，可以创建 thread、reply、emoji reaction。
- 可以在 Linear 内 approve、request changes 或 submit review comment，并同步到 GitHub。
- 有权限且 PR ready 时，可以直接从 Linear merge pull request。
- Line/change comments 可用，但 Linear FAQ 明确当前 review submission 是 PR-level，不是 commit-by-commit review。
- GitHub draft review state 不完整同步到 Linear；Linear 只同步 submitted review state。

### Notifications And Preferences

- Diffs enabled 后，Linear 可以通知 PR activity：new comments and reviews、review requests、mentions、CI failures。
- Pull request notification mode 包括 All activity、All activity by people、Reviews and comments、Reviews and comments by people、None。
- `by people` 模式会过滤 GitHub 标识为 bot actor 的活动。
- 个人 Code & reviews settings 覆盖 code theme、font size、line height、pull request notifications、auto-convert draft PRs 等。
- Auto-convert draft PRs 会在 requested review 或 approved 后把 draft pull request 进入 ready-for-review status。

### AI / Agent Features

- Linear 产品页强调 agent access from every diff：从 diff 直接让 agents 修 review feedback、处理 refactor、tests、follow-up edits。
- Guided reviews 处于 beta；它组织 diffs，解释 changed what and why，并按 semantic order 引导审阅。
- Guided reviews 目标是把 large PR 的 supporting changes 和 glue code 与核心变化区分开。
- Linear Docs 说明 Guides 可在 Business 和 Enterprise plans 使用，beta 期间免费。
- Guided reviews 在 dedicated `Guide` tab 中出现，带有到相关 pull request diff 位置的 direct links。
- Guide generation 由 GitHub integration settings 的 Pull Requests 区域中的 `Generate Pull Request guides` toggle 控制。
- Linear Docs FAQ 声明其 AI features 的数据使用政策：不使用客户数据训练 Linear 自有 AI 模型；相关数据仅用于交付 AI 功能。

### Code Intelligence And Structural Highlighting

- Product page 提到 structural highlighting：减少 formatting-only edits 干扰，聚焦代码变化。
- Product page 提到 review code in context：diff tied directly to issue。
- Product page 提到 built for speed, still synced with GitHub：comments、approvals、PR status up to date。
- FAQ 明确当前不展示 rich check-run annotations，例如 inline failure locations 或 detailed external tool output；只显示 overall check status and basic details。

### Preview Links

- 如果 PR 包含一个或多个 preview links，Linear issue 会增加 preview link shortcut。
- 该行为属于 GitHub integration / PR metadata extraction，不是 diff renderer 的职责。

## Cradle Current-State Evidence

### Existing Local Diff Surface

- `apps/web/src/features/browser/workspace-diff-viewer.tsx` 已使用 `@pierre/diffs` / `@pierre/diffs/react` 渲染 workspace Git patches。
- 该 viewer 支持 `split` 和 `unified`，使用 worker pool、word-level line diff、sticky headers、line selection。
- 该 viewer 当前由 `browser` feature 承载 tab content，但 README 已声明 workspace diff surfaces keep their own feature ownership and are rendered there only as panel tab content。
- `apps/web/src/features/git/changes-panel.tsx` 从 Changes panel 打开 workspace diff tab，并支持滚动到指定 path。
- `apps/web/src/features/chat/blocks/edit-file-block.tsx` 和 `tool-call-block.tsx` 使用 `@pierre/diffs/react` 展示 tool output 的 file edit preview。

### Existing Server Git Surface

- `apps/server/src/modules/git/service.ts` 已有 workspaceId scoped Git API：status、file statuses、branches、remotes、graph、checkout、create branch、fetch、diff。
- `apps/server/specs/capabilities/git.md` 当前把 commit/push/pull/diff 等更重语义后置；但实现中已有 diff 能力。
- Git module 当前 owner 是 local repository facts and commands，不应拥有 review lifecycle、remote PR identity、comments、approvals 或 agent review work orders。

### Gaps

- 没有独立 `diff-review` 或 `code-review` owner。
- 没有 PR/diff lifecycle data model：review thread、review comment、review round、approval、review intent、viewed state。
- 没有 remote source adapter abstraction：GitHub、local working tree、agent branch、future Linear import。
- 没有 semantic diff graph、review guide、structural highlight mode 或 formatting-only suppression policy。
- 没有从 diff 直接启动 agent fix loop 的 domain contract；目前聊天 tool diff 只展示结果。
- 没有 per-user review notification mode 或 diff display preferences。
- 没有 GitHub code access / personal connection / source capability readiness model。
- 没有 merge permission / merge operation ownership boundary。
- 没有 preview link extraction owner。

## Design Takeaways For Cradle

- `diff-review` 必须成为独立 feature owner；它读 `git`、`workspace`、`issue`、`session`、`agent` facts，但不把 lifecycle 写入那些 namespace。
- `git` 应继续只提供 repository facts、patch materialization、branch operations、remote metadata。
- `browser-panel` 只做 host surface，不拥有 diff semantics。
- `@pierre/diffs` 已经适合作为 low-level renderer/parser，不要发明新的 diff rendering primitive。
- Review lifecycle 应以 immutable diff revision + mutable review state 建模，避免把 comments 直接挂在 transient patch line number 上。
- Agent integration 必须是 review-owned work order：从 thread/comment/range 创建 agent task，agent 结果回写 review-owned event，不直接改 GitHub/issue namespace。
