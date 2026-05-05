# Agent Client Console Architecture

Cradle should evolve as an app-owned agent client console, not as a self-built coding agent runtime.
The product value is in supervising, connecting, normalizing, and operating external coding-agent backends.
Codex App Server, Claude Agent SDK, and ACP agents should remain backend capabilities that Cradle integrates rather than reimplements.

## Decision

Cradle should keep the agent integration layer internal for now.

The immediate goal is not to create reusable packages. The goal is to establish a stable product architecture for a desktop app that wraps and coordinates existing coding-agent systems. The internal architecture should be clean enough that some pure logic can be extracted later, but package extraction should be a result of proven stability, not a starting assumption.

This means Cradle should not build an all-purpose `agent-runtime core` that owns model loops, planning, tool execution, memory, or skill loading. Those responsibilities already belong to the external agent systems. Cradle should own the client-side control plane around them.

## Product Assumption

Cradle is unlikely to become a first-party coding agent implementation.

The more realistic product shape is:

- Codex App Server provides a local JSON-RPC agent backend.
- Claude Agent SDK exposes Claude Code capabilities programmatically.
- ACP provides a protocol boundary between clients and coding agents.
- Cradle provides a focused desktop experience for connecting these systems to workspaces, sessions, approvals, timelines, skills, and user-facing workflows.

This assumption changes the architecture. Cradle should optimize for adapter quality, event normalization, session supervision, and product semantics. It should not optimize for replacing the agent backend itself.

## Core Principle

Cradle owns product semantics. External agent systems own agent execution semantics.

Cradle-owned semantics include:

- Workspace selection and trust.
- Session and thread presentation.
- User approval UX.
- Backend connection lifecycle.
- Timeline rendering and persistence policy.
- Skills inventory UX and namespace policy.
- Delegation from app features into agent sessions.
- Compatibility between app-level workflows and backend capabilities.

External-agent-owned semantics include:

- Model loop behavior.
- Tool choice and planning.
- Agent memory and context assembly.
- Provider-specific authentication.
- Backend-specific skills loading.
- Tool execution semantics inside the agent runtime.
- Protocol-specific thread, turn, and item lifecycle.

When these two layers overlap, Cradle should prefer a thin adapter plus explicit capability mapping over a fake universal abstraction.

## Internal-First Rationale

The integration layer should stay internal because the stable abstraction is not known yet.

Codex App Server, Claude Agent SDK, and ACP do not expose identical concepts. They may all support conversations, streaming, approvals, tools, and skills, but their lifecycle details are different. If Cradle defines a public package API too early, the API will either become too weak to be useful or too opinionated around whichever backend was integrated first.

Internal-first keeps the architecture reversible:

- Cradle can preserve provider-specific details where they matter.
- Normalized app events can evolve without versioning pressure.
- The renderer contract can remain stable even when backend adapters change.
- Backend-specific experiments can happen without pretending they are general.
- Package boundaries can be extracted later from code that has already survived real use.

The bar for package extraction should be evidence, not cleanliness. A module should only be extracted after it has multiple stable consumers, no direct dependency on Cradle product lifecycle, and a public API that is unlikely to change across several backend integrations.

## Backend Integration Model

Cradle should model external systems as agent backends.

An agent backend is a connected capability provider that can start or resume agent work, emit progress, request approvals, expose account or capability metadata, and stop active work. Each backend adapter should be allowed to preserve its source protocol internally.

The shared Cradle layer should focus on a small set of app-facing concepts:

- Backend identity and capabilities.
- Connection state.
- Session association.
- Run lifecycle.
- Timeline events.
- Approval requests.
- Usage and diagnostics.
- Backend-specific escape hatches when the UI needs precise information.

This avoids pretending that every backend has the same model. The goal is not perfect isomorphism. The goal is a stable Cradle-facing control surface.

## Timeline Model

Cradle should maintain an internal timeline model between backend streams and renderer UI.

The timeline is not a chat protocol. It is an app-level representation of an agent run. It should be able to represent assistant text, reasoning, command execution, file edits, approval requests, tool calls, usage updates, errors, interrupts, and completion.

This timeline should be the main compatibility layer for the renderer. Backend-specific streams can be converted into timeline events, and renderer features can decide how to present them as chat messages, task activity, devtool traces, or issue delegation progress.

The timeline model should be intentionally conservative:

- Preserve source backend IDs where possible.
- Keep event ordering explicit.
- Keep partial and terminal states distinct.
- Avoid flattening command, tool, and file-edit activity into plain chat text.
- Allow backend-specific metadata without making it the primary UI contract.

AI SDK `UIMessage` can still be useful for chat rendering, but it should not be the only internal representation. Cradle needs an agent activity model first, and chat messages can be derived from it when appropriate.

## Skills Model

Cradle should manage skills as inventory, configuration, and trust, not as an agent skills runtime.

Agent skills are becoming a portable convention across multiple coding-agent ecosystems. That does not mean Cradle should own skill execution. The backend should decide how and when skills enter model context. Cradle should help users discover, inspect, import, validate, enable, disable, and route skills to compatible backends.

The most important rule is namespace ownership.

Cradle may read from external namespaces when needed for compatibility. Cradle should not casually write into namespaces owned by other products. If Cradle creates or manages skill state, that state should belong to Cradle unless the user explicitly chooses an integration action that writes through a backend-supported mechanism.

Cradle-owned skill responsibilities include:

- Skill inventory across known sources.
- Metadata validation.
- Duplicate and conflict detection.
- Trust and provenance display.
- Import and export workflows.
- Backend capability mapping.
- Enable and disable intent routing.
- Clear distinction between read-only external sources and Cradle-owned writable state.

Backend-owned skill responsibilities include:

- Runtime skill discovery.
- Prompt/context injection.
- Skill execution behavior.
- Backend-specific config semantics.
- Backend-specific marketplace or plugin installation rules.

## Approval Model

Approvals should be owned by Cradle's product layer, even when the request originates from a backend.

External agents can request permission to run commands, edit files, access network, use additional tools, or continue with elevated capability. Cradle should normalize these requests into app-level approval objects that the UI can present consistently.

Cradle should not erase backend-specific decision options. If a backend supports distinct approval choices, the adapter should preserve them while mapping them into a common approval UX shape. The user should see a coherent Cradle interaction, but the backend should receive a valid backend-specific response.

This is a control-plane boundary. It is one of the main reasons the integration layer belongs inside the app first.

## Package Extraction Criteria

Package extraction is allowed later, but it should be earned.

A module is a package candidate only when all of the following are true:

- It has at least two stable Cradle consumers.
- It does not depend on app lifecycle, windows, routes, workspace ownership, database schema, or IPC services.
- It has a small public API.
- It can be tested independently.
- It does not encode assumptions from only one backend.
- It can remain compatible across several backend updates.

Likely future candidates are small and boring:

- JSON-RPC transport helpers.
- Schema-generated Codex client helpers.
- Timeline event reducers.
- Skill metadata parsing and validation.
- Backend-independent retry and connection state utilities.

Unlikely candidates are broad and product-shaped:

- A full agent runtime.
- A full chat engine.
- A full skills manager.
- Workspace/session orchestration.
- Approval UX and policy.
- Product-level delegation flows.

## Design Tradeoff

The main tradeoff is between clean reuse and honest ownership.

Package-first can look cleaner, but it pressures the architecture to stabilize before the product has enough evidence. Internal-first can look less elegant, but it protects the design from premature public contracts and lets Cradle learn from real backend integrations.

For this product, honest ownership is more important than early reuse.

Cradle should first build a strong internal boundary:

- External backend protocols stay behind adapters.
- Cradle timeline events become the renderer-facing activity model.
- Skills remain inventory and configuration, not runtime execution.
- Approvals become a first-class product interaction.
- App features integrate through Cradle-owned semantics rather than backend-specific calls.

Once these boundaries survive real Codex, Claude, and ACP integrations, the stable pure pieces can be extracted deliberately.

## Design References

设计 Cradle 内部 schema 时，最值得参考的不是某一个协议，而是分层抄：

When designing Cradle's internal schema, the best reference is not any single protocol, but a layered combination:

Codex App Server 抄“agent run / thread / turn / item / approval”的领域模型。 

Copy the domain model of "agent run / thread / turn / item / approval" from Codex App Server, as it is the most mature and complete representation of coding-agent execution lifecycle.

Responses API's style of "streaming event naming, delta/completed lifecycle, typed output items" for the timeline event design, as it is a widely adopted convention for agent response streaming.

Copy the protocol boundary of "client-agent decoupling, JSON-RPC, capability negotiation" from ACP, as it is designed for flexible client integration and supports a wide range of agent backends.

Copy the engineering discipline of "initialize capability exchange, request/notification/response patterns, backward compatibility rules" from LSP, as it is a proven model for maintaining stable integrations while evolving features.

Copy the observability structure of "event envelope, traceability, source/id/type/time, resource/attributes" from CloudEvents and OpenTelemetry, as it provides a robust framework for logging and monitoring agent interactions.

Don't look for a so-called "schema design bible". If it exists, it would say: first define a stable envelope, then define domain payloads; first define capabilities, then features; first define lifecycle state machines, then UI; any provider-specific fields should be in metadata and not pollute the core model.

| Cradle concept  | Codex App Server | Claude Agent SDK             | ACP                 | Notes                       |
| --------------- | ---------------- | ---------------------------- | ------------------- | --------------------------- |
| Session         | Thread?          | SDK session/state?           | Session             | Cradle session is app-owned |
| Run             | Turn             | streamed run/query           | prompt turn         | one user delegation         |
| Timeline item   | Item/event       | RunItemStreamEvent/raw event | protocol update     | normalized                  |
| Approval        | approval request | interruption/approval        | permission request? | product-owned               |
| Skill inventory | codex skills?    | Claude skills?               | maybe capability    | Cradle owns inventory       |

## Implementation Notes

Backend adapters produce typed events.
Reducers produce product state.
Renderers consume projections.
Capabilities, not backend names, drive behavior.

## Practical Direction

The next architecture work should focus on concepts, not package layout.

The most important internal contracts to clarify are:

- What is an agent backend?
- What is a Cradle session versus a backend thread or turn?
- What events belong in the Cradle timeline?
- What approval decisions must the product support?
- What skill state does Cradle own versus merely observe?
- Which backend capabilities are required, optional, or experimental?
- How much backend-specific data should the renderer be allowed to see?

These questions should be resolved before optimizing file organization or package boundaries. If the concepts are correct, the code can move later. If the concepts are wrong, package boundaries will only make the wrong abstraction harder to change.

