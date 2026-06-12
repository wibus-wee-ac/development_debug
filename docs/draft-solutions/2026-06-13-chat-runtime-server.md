我们就来好好设计一下：**如何在本地优先（Local-First）、基于 SQLite 的 AI Agent 引擎中，优雅且克制地设计一套真正的 Event Sourcing（ES） + CQRS 架构，并且绝不让磁盘爆炸。**

做好这套架构的核心秘诀在于四个字：**分离、聚合、指针、快照**。

下面是为你量身定制的落地设计蓝图：

---

### 第一步：重新定义事件的“粒度” (Event Granularity) —— 解决数量爆炸

设计 ES 的第一步，是明确“什么是事件”。在 AI Agent 中，我们必须在**领域事件（Domain Events）**和**流数据（Stream Data）**之间划清界限。

*   **绝对不要**把大模型的每一个字（Chunk / Token）存成 Event。这叫日志（Log），不叫业务事件。
*   **正确的 Domain Events 应该长这样**（只关注状态转移和语义完成）：
    1.  `SessionStarted` (携带初始配置)
    2.  `UserMessageAppended` (用户发了句话)
    3.  `RunStarted` (开始请求大模型)
    4.  `ToolCallRequested` (模型决定调用工具，携带参数)
    5.  `ToolCallApproved` / `ToolCallDenied` (用户同意/拒绝了操作)
    6.  `ToolCallCompleted` (工具执行完毕)
    7.  `AssistantMessageCompleted` (模型这一轮的话终于说完了，合并成一段完整文本)
    8.  `RunCompleted` / `RunFailed` (一轮执行彻底结束)

**设计收益**：一轮极其复杂的对话，在数据库里其实只会产生 10~20 条事件。数量完全可控！至于那些流式的字（打字机效果），继续用你现在的 `stream-trace.ts` 写到本地的 `.jsonl` 文件里，供排错使用，不需要进 SQLite。

---

### 第二步：设计 SQLite Event Store (事件库) 结构

你需要一张真正的、且只能 `APPEND`（追加）的表，这就是你的 **Single Source of Truth（唯一事实来源）**。

```typescript
// schema/event-store.ts
export const eventStore = sqliteTable('event_store', {
  sequenceId: integer('sequence_id').primaryKey({ autoIncrement: true }), // 全局递增的序列号
  aggregateId: text('aggregate_id').notNull(),    // 例如: chat_session_id
  aggregateType: text('aggregate_type').notNull(), // 例如: 'ChatSession'
  eventType: text('event_type').notNull(),         // 例如: 'ToolCallCompleted'
  payload: text('payload').notNull(),              // JSON 格式的事件详情
  version: integer('version').notNull(),           // 乐观锁版本号 (非常重要!)
  timestamp: integer('timestamp').notNull(),       // 发生时间
})

// 联合索引：快速取出某个 Session 的所有历史事件
// CREATE INDEX idx_aggregate ON event_store(aggregate_id, version);
```

---

### 第三步：解决载荷（Payload）爆炸 —— 引入“凭证模式” (Claim Check Pattern)

如果 Agent 读取了一个 10MB 的日志文件，或者生成了一个 5MB 的图片，绝对不能把这 10MB 的数据塞进 `ToolCallCompleted` 的 `payload` JSON 里！

**设计模式：Claim Check（行李寄存牌模式）**
*   当工具执行完，产生大量文本/二进制数据时，先把它写入本地文件系统（比如 `~/.cradle/blobs/{sha256_hash}.txt`）。
*   在事件的 Payload 中，只存一个“凭证”（指针）：
    ```json
    {
      "toolId": "read_logs",
      "resultRef": "local-blob://sha256:abcd1234efgh5678",
      "summary": "Read 10000 lines of log"
    }
    ```
*   **设计收益**：SQLite 里的事件流永远都是极小的纯文本 JSON。不管 AI 怎么折腾文件，数据库永远不会膨胀。文件系统自带的空间管理也远比 SQLite 容易清理。

---

### 第四步：读写分离 (CQRS) 与 投影器 (Projector)

有了 Event Store，你现在的各种 `sessions`, `messages`, `backend_runs` 表怎么办？
答案是：它们变成 **Read Models（读模型 / 视图）**。

1.  **Write Side（写端 - 负责规则验证）**：
    *   API 收到请求（如 `/chat/response`）。
    *   从 `event_store` 读出这个 Session 的所有历史事件。
    *   在内存中重放（`reduce`），得到当前状态（Aggregate State）。
    *   判断能不能发消息？能。生成并保存一个 `RunStarted` 事件。
2.  **Projector（投影端 - 负责生成供 UI 读取的数据表）**：
    *   后台监听 `event_store` 的写入（或者在同一个 DB 事务中触发）。
    *   如果收到 `RunStarted`，Projector 去执行 `db.insert(backend_runs)...`
    *   如果收到 `AssistantMessageCompleted`，Projector 去执行 `db.insert(messages)...`

**设计收益**：你的 UI 渲染、查询逻辑完全不需要改变，依然去查那些结构化的表。但是，那些表的定位变成了“随时可以被丢弃并根据 Event 重新生成的缓存”。

---

### 第五步：终极杀招 —— 快照与清理 (Snapshotting & Archiving) 以防无限堆积

即使限制了粒度和 Payload，一年下来的对话事件也会非常多。Event Sourcing 必配的机制是 **快照（Snapshot）**。

*   每当一个 Session 产生了 100 个事件，或者每当一个 `RunCompleted` 发生后。
*   系统在后台计算出一个完整的状态树（当前的变量、当前的对话上下文），把它保存到一张独立的快照表 `session_snapshots` 里。
*   **重点来了：冷数据归档**。对于已经生成了快照的、很老的 Events，你可以直接从 SQLite 的 `event_store` 中 `DELETE` 掉，并把它们**导出压缩**为本地磁盘上的一个 `.events.gz` 文件（或者存入 Chronicle）。
*   **恢复逻辑**：下次要恢复这个 Session，只需要读取 `最新快照` + `快照之后的少量新事件`，瞬间复原。

---

### 这套架构对你们项目的颠覆性改变（以 `chat-runtime` 举例）

现在的代码中，如果遇到断电或异常崩溃，会留下状态为 `streaming` 的孤儿 Run，必须要靠复杂的 `recovery.ts` 去修数据库。

**如果采用这套 ES 架构：**

1. 进程崩溃。
2. 进程重启。
3. 系统根本不需要 `recovery.ts` 去修数据。
4. 当用户再次点开这个 Chat，系统从 `event_store` 读事件：`[RunStarted] -> [ToolCallRequested]`，后面没有了。
5. 系统在内存中重放后，瞬间发现：**“哦，状态停在等待工具执行结果！”**。
6. 系统直接重新发起该工具调用，或者向前端抛出提示：“上次意外中断，是否重试？”。
7. **数据永远不会处于“不一致”的状态，因为你记录的是事实（Facts），而不是快照。**

### 总结一下设计图：

```text
[用户行为 / AI 行为] 
       │
       ▼
(Commands) -> [校验业务规则] -> [生成 Events]
       │                           │
       ▼                           ▼
[本地文件系统] <--- (存大文件)  [Event Store (SQLite)] (唯一事实来源, 极小, 极快)
(Claim Check)                      │
                                   ▼
                            [Projectors (投影器)]
                                   │
                                   ▼
                      [Read Models (当前的业务表)]
                      (sessions, messages, backend_runs)
                                   │
                                   ▼
                        [Elysia APIs / Frontend]
```

如果按照这套模式去重构 `chat-runtime` 和 `agent-interaction-runtime`，你将得到一个**坚不可摧、自带时空穿梭（Time-Travel Debugging）、且不会撑爆用户硬盘**的顶级 Agent 引擎

——————————

必须提前把下面这“致命的深坑”设计好。


### 坑：SQLite 锁冲突与并发写事件（Concurrency Lock）
你们使用了 SQLite，并且系统里有高频的流式数据、文件监听（`file-watch.ts`）和用户 steer（实时引导）。

*   **问题在哪**：SQLite 虽然有 WAL 模式，但它本质上同一时间只允许**一个写入者**。
*   **深坑爆发**：
    1.  AI 正在流式输出，Projector 疯狂地向 SQLite 写入消息状态更新。
    2.  与此同时，外部的 `file-watch.ts` 监听到文件变化，试图写入一个 `WorkspaceFileChanged` 事件。
    3.  用户此时又点下了“取消（Cancel）”，触发另一个写入。
    这会导致频繁的 `SQLITE_BUSY` 数据库锁死异常。
*   **解决方案：内存队列 + 串行写入（Actor Model 思想）**。
    *   每一个 `Session` 在内存中应该拥有一个排他的、极简的 **Event Queue**。
    *   该 Session 产生的所有事件，必须先 push 到这个内存队列里，由队列**串行化（Single-threaded loop）**地写入 SQLite。
    *   这样可以确保单个 Session 的事件 `version` 绝对单调递增，且不会给 SQLite 造成高并发写压力。

### 坑：流式 UI 与持久化投影的延迟不一致（Projection Latency）
你们使用了 SSE（Server-Sent Events）流式推给前端渲染（`stream/sse.ts`）。

*   **问题在哪**：在 CQRS 中，写 Event 库和更新 Read Model（也就是你的 `messages` 页面展示表）是**异步分步**进行的。
*   **深坑爆发**：
    1.  AI 吐出一个字，事件发射出去。
    2.  SSE 管道极其轻量，把字瞬间送到了前端 UI。
    3.  但由于 SQLite 此时正在写磁盘，Projector 更新 `messages` 表的延迟慢了 50 毫秒。
    4.  用户此时刷新了页面（或者另一个组件去查 `GET /messages`），发现刚吐出来的字在数据库里“不存在”。
    5.  UI 产生严重的“闪烁”或“时光倒流”现象。
*   **解决方案：内存投影（In-Memory Read Model）**。
    *   对于当前活跃的正在 Streaming 的 Session，Projector 应该同时更新一个 **内存中的快速视图（Fast Cache）**。
    *   前端查询时，优先走内存 Cache，Cache 没有再去查 SQLite 的持久化表。
    *   或者采用“强一致性写入”：在本地单用户 IDE 场景下，允许 Projector 和 Event Store 在同一个数据库事务（Transaction）中同步写入，牺牲一丁点写入性能，换取 UI 数据的绝对一致。
