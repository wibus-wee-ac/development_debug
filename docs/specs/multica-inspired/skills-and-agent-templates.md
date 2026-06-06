# Skills and Agent Templates

## 直接结论

Cradle 应把 Multica 的 skill 系统拆成两个稳定概念：

- **Skill**：Cradle-owned usage knowledge。它是可复用说明、流程、脚本和示例，不是 runtime tool。
- **Template**：创建 agent 身份时的预设组合。它可以引用 skills、instructions、model/runtime hints，但不拥有 skill 内容。

关键架构原则：Cradle 可以读取外部 skill 标准，可以把 Cradle-owned skill 物化到 provider-native 目录，但不能把 provider 的全局 skill namespace 当作 Cradle 的写入目标。

## Multica 证据

强证据：

- `server/migrations/008_structured_skills.up.sql`: `skill`、`skill_file`、`agent_skill`。
- `server/internal/handler/skill.go`, `skill_create.go`: skill CRUD/import/search。
- `server/internal/handler/agent_template.go`: list/get/create from template。
- `server/internal/agenttmpl/templates/*.json`: template catalog。
- `server/internal/daemon/execenv/context.go`: provider-native skill materialization。
- `packages/core/skills/frontmatter.ts`: frontmatter parsing。
- `docs/agent-quick-create-plan.md`: Template → Skill Finder → AI Create Agent plan。

## Skill Domain Model

```ts
interface Skill {
  id: string
  workspaceId: string
  name: string
  description: string
  content: string
  files: SkillFile[]
  config: SkillConfig
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface SkillFile {
  id: string
  skillId: string
  path: string
  content: string
}

interface AgentSkillAttachment {
  agentId: string
  skillId: string
  createdAt: string
}
```

标准：

- `(workspaceId, name)` 唯一。
- `path` 必须是相对路径，禁止 `..`、绝对路径、home expansion。
- `content` 是 canonical `SKILL.md` 正文。
- `files` 是 supporting files，不允许覆盖 `SKILL.md` canonical content。
- `config.origin` 可记录 import source，但不作为真相源。

## Skill Frontmatter

Runtime 对 `SKILL.md` frontmatter 的要求不完全一致。Cradle canonical skill 必须在写入时补齐最低可用 frontmatter：

```yaml
---
name: code-review
description: Review code changes for correctness, maintainability, and tests.
---
```

标准：

- `name` 必须 parseable、非空、slug-stable。
- `description` 建议存在。
- 不自动重写已有 frontmatter 的未知字段。
- 缺 `name` 时可以注入。
- 完全缺 frontmatter 时可以合成。

## Import Sources

Multica 已支持 import from skills.sh、GitHub、ClawHub 等路径。Cradle 目标 import pipeline：

```ts
type SkillImportSource =
  | { kind: 'github'; repo: string; ref?: string; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'local'; path: string }
  | { kind: 'bundle'; files: Array<{ path: string; content: string }> }
```

Import 标准：

- detect source 后进入 fetcher。
- fetcher 返回 normalized bundle，不直接写 DB。
- validator 检查 file paths、frontmatter、size limit、binary policy。
- materializer 在 transaction 中 create/update skill + files。
- find-or-create by `(workspaceId, name)` 可用于 template flow。

不建议照搬：

- 不把 ClawHub 作为战略 marketplace。它可以是临时 importer，但不是 Cradle capability owner。
- 不让 AI 直接安装到 `~/.claude/skills` 或其他 provider global path。

## Runtime Materialization

Multica provider-native paths：

| Provider | Skill directory |
| --- | --- |
| Claude | `.claude/skills/{name}/SKILL.md` |
| Codex | per-task `CODEX_HOME/skills/{name}/SKILL.md` |
| GitHub Copilot | `.github/skills/{name}/SKILL.md` |
| OpenCode | `.opencode/skills/{name}/SKILL.md` |
| OpenClaw | `skills/{name}/SKILL.md` with synthesized config |
| Pi | `.pi/skills/{name}/SKILL.md` |
| Cursor | `.cursor/skills/{name}/SKILL.md` |
| Kimi | `.kimi/skills/{name}/SKILL.md` |
| Kiro | `.kiro/skills/{name}/SKILL.md` |
| Antigravity | `.agents/skills/{name}/SKILL.md` |
| Fallback | `.agent_context/skills/{name}/SKILL.md` |

Cradle 标准：

- materialization happens per task。
- write only into task workdir/env root or a Cradle-managed runtime home。
- record sidecar manifest for local directory mode。
- remove stale managed skill dirs on reuse before hydrating new set。
- never delete user-created skill dirs unless manifest proves ownership。

## Agent Templates

Template 是静态 catalog，不是 skill vendor：

```ts
interface AgentTemplate {
  slug: string
  name: string
  description: string
  category?: string
  icon?: string
  instructions: string
  skills: Array<{
    sourceUrl: string
    required?: boolean
  }>
  defaults?: {
    visibility?: 'private' | 'workspace'
    maxConcurrentTasks?: number
    model?: string
    thinkingLevel?: string
  }
}
```

Create from template flow：

1. Load template by slug。
2. Resolve runtime/provider compatibility。
3. Import or reuse each referenced skill by name。
4. Create agent with instructions/defaults/overrides。
5. Attach imported/reused skills。
6. Return created agent plus imported/reused skill IDs。

Transaction boundary：

- agent create + skill attachment 必须 transactional。
- external fetch 可以在 transaction 前完成，避免长事务。
- 同名 skill conflict 必须 deterministic：reuse existing 或 explicit conflict，不 silent overwrite。

## Skill Finder 预案

Multica plan 的洞察：Skill Finder 不需要后端 server-side LLM，可以复用 task execution pipeline。

Cradle clean version：

```ts
interface SkillFindRequest {
  prompt: string
  agentId: string
  sourceCatalog?: string[]
}

interface SkillRecommendation {
  name: string
  description: string
  source: SkillImportSource
  reason: string
  confidence: number
}
```

Flow：

1. User describes need。
2. Cradle enqueues `skill_find` task using selected agent/runtime。
3. Runtime prompt includes curated skill index and output schema。
4. Agent returns structured recommendations through a scoped tool/API。
5. Results become task artifact, not immediate DB writes。
6. User selects recommendations to import。

标准：

- AI cannot directly import/install skills without user confirmation。
- recommendations are artifacts tied to task。
- curated catalog must be versioned。
- import step uses normal import pipeline。

## AI Create Agent 预案

AI Create Agent 是 Template + Skill Finder + Create Agent 的组合，不应成为第三套 agent creation API。

Flow：

1. User describes desired teammate。
2. Enqueue `agent_design` task。
3. Agent proposes:
   - name
   - description
   - instructions
   - runtime requirements
   - skills recommendations
   - risk/permission notes
4. User reviews proposal。
5. Server creates agent through normal create + attach flow。

Output schema：

```ts
interface AgentCreationProposal {
  name: string
  description: string
  instructions: string
  recommendedSkills: SkillRecommendation[]
  runtimeRequirements: {
    providers: string[]
    needsMcp: boolean
    needsSecrets: string[]
  }
  warnings: string[]
}
```

## Cradle Owner Boundaries

| Concern | Owner |
| --- | --- |
| Skill canonical data | `skills` |
| Skill import/fetch/validation | `skills` |
| Agent identity and template catalog | `agent-identity` |
| Runtime compatibility | `provider-runtime` / `provider-catalog` |
| Skill materialization into task env | `provider-runtime` with `skills` bundle input |
| AI recommendations | `chat-runtime` task artifact |
| UI create flow | `apps/web` feature surface, reading owners through APIs |

## 验收口径

- Cradle skill DB 是 canonical source，provider directories are projections。
- Template flow 不会覆盖已有同名 skill。
- Skill file path validation 覆盖 traversal、absolute path、duplicate path。
- Provider-native materialization 有 per-provider tests。
- Skill Finder 只产出 recommendation artifact，不直接写 DB。
- AI Create Agent 必须有 user confirmation gate。
- Agent skill attachment 不复制 skill content 到 agent row。

