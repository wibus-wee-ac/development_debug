<!-- Once this directory changes, update this README.md -->

# Main/Features/Backend Control Plane

Backend control plane 负责 Cradle 自己拥有的 backend binding、run lifecycle、append-only timeline 与 capability snapshot。
它把 product session 和 provider-native session/thread/runs 解耦，避免 backend 状态继续泄漏进 `chat/` 或 `agent-runtime/`。
这里放 durable control-plane 语义，不要把这些记录重新塞回 session 表或 provider config。

## Files

- **backend-control-plane.ts**: DB-backed store、application service 与 singleton accessor，负责 binding/run/timeline/capability 持久化入口
- **timeline-events.ts**: typed timeline event unions、runtime parser 与 codec；`UIMessageChunk` 投影已下沉到 shared timeline projector
- **types.ts**: backend binding、run、timeline、capability snapshot 与 store/service 合约
- **__tests__/**: control-plane feature 的行为回归测试
