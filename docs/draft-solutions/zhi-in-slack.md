# Zhi in Slack

## What's Zhi?

https://github.com/imhuso/cunzhi

还在为 AI 助手总是提前结束对话而抓狂吗？明明还有很多要聊，它却说"还有什么需要帮助的吗？"寸止 专治这个毛病！

当 AI 想要"草草了事"时，寸止会及时弹出对话框，让你能够继续深入交流，直到真正解决问题为止。

## So

我们需要在 apps 里新增一个 MCP human-in-the-loop bridge，Slack 只是交互面，zhi 是暴露给 agent 的 MCP tool。

暂时不纳入我们的核心功能范围，先做个独立的实验性的实现，看看效果如何。后续如果证明这个功能很有用，我们再考虑把它纳入核心功能里。

Agent Session 在调用 MCP zhi 时，必须能把这次 zhi 调用绑定回正确的 Agent Session；否则多个 session 同时跑时，用户看到的弹窗/Slack 提问分不清是谁的。

原来的寸止弹窗没有天然 session identity。它只知道“有一次 MCP tool call 要问用户”，但不知道这是哪个 agent、哪个任务、哪个 Slack thread、哪个窗口、哪个 repo。多个 agent session 并发时，弹窗就全都长一样。这就是根因。

正确解法是在 MCP tool call 层引入 session context，而不是靠弹窗内容猜。

也就是说，每个 Agent Session 启动 MCP 时，MCP 应该要带上一个稳定的 session_id，然后 zhi 调用时自动继承这个 session id。

我好奇这个能不能通过搜索启动这个 MCP 的 PPID 来实现？因为 靠 Agent 上下文维持 session_id 是个完全不可能实现的事情。。。

Agent Session A
  └─ MCP client context:
       session_id = sess_a
       slack_channel_id = C123
       slack_thread_ts = T123

Agent Session B
  └─ MCP client context:
       session_id = sess_b
       slack_channel_id = C123
       slack_thread_ts = T124

然后我想要的行为是：

Agent 调用这个 MCP zhi tool，然后这个 tool 通过 session_id 找到对应的 slack_thread_ts，发消息过去，如果没有 Thread （就是第一次发消息），就创建一个新的 Thread，并把这个 thread_id 绑定回 session_id。

slack_channel_id 的话，应该是靠用户自行靠 /slash command 绑定的

环境变量：

- Slack Bot 相关 Token，包括 SIGNING_SECRET、BOT_TOKEN 等等的
- 

持久化方案：本地化一个 json + zod 搞定所有配置的持久化

我在想我们需要哪些 slash command：

- /zhi bind -- 绑定当前 channel 为 zhi 的输出面，以后的 zhi 输出都会发到这个 channel 里：已绑定 zhi 到当前 channel。后续无法定位 thread 的 session 会在这里创建 thread。
- /zhi unbind -- 解绑当前 channel：已解绑 zhi 与当前 channel 的绑定关系。后续 zhi 输出不会再发到这个 channel 里。
- /zhi status -- 查看当前绑定状态和最近 session 映射。用好 Slack Bot 的 UI/Block/组件 能力

zhi 调用流程：

1. zhi MCP tool 被调用
2. MCP server 读取自己的 pid、ppid、ancestor pids、cwd、cmdline 一些可以被拿来做 fingerprint 的东西
3. 请求 bridge resolve session
4. bridge 用 ancestor pids 匹配 ProcessSessionRegistry
5. 找到 session binding
6. 如果 session 没 thread：
   - 查用户 /zhi bind 的 channel
   - 发 root message 创建 thread
   - 把 thread_id 绑定回 session
7. 发 zhi prompt 到 thread
8. 创建 pending call
9. 阻塞等待 Slack thread reply
10. 收到 reply 后 resolve pending（一般是需要用户主动 @bot 回复才行的）
11. MCP tool 返回给 agent

不过注意，zhi tool schema 里面我想起来有个「"predefined_options": ["继续补测试", "先只做 review", "暂停"]」这种东西，目前来看的话，还是算了，不要这种

就是简单的就行了～

完整的旅程：

1. 用户执行 /zhi bind，把 Zhi 默认输出 channel 绑定到当前 Slack channel。

2. 用户启动 Agent Session。
   系统创建 session_id，但此时还没有 slack_thread_ts。

3. Agent 第一次调用 zhi。
   zhi 根据 MCP 调用来源解析 session_id。

4. 系统发现该 session 没有 slack_thread_ts。
   于是到绑定的 channel 发一条 root message，创建 Slack thread。

5. 系统把 root message 的 ts 保存为该 session 的 slack_thread_ts。

6. 系统把 zhi prompt 发进这个 thread，并挂起 MCP tool call。

7. 用户在同一个 thread 回复。

8. 系统根据 channel_id + thread_ts 找到 session_id 和 pending zhi call。

9. 系统把用户回复返回给 MCP tool，Agent Session 继续执行。

10. 后续同一 session 的 zhi 调用都复用同一个 thread。



————————

You should active Skills: multi-work, exec-plan

只有完全完成了 Electron Wrapper 的开发，才需要向用户报告，其他时间，靠 multi-work 和 exec-plan 来管理开发进度和细节就好

可以直接把 cunzhi 给 clone 下来到我们这里来你一个一个对着来开发

--------

代码依旧还是 TypeScript 实现哈，使用 @slack/bolt 来实现 Slack Bot 的功能，保持和我们现有代码库的技术栈一致。

做好 E2E / Unit 测试，模拟用户在 Slack 上的交互，确保整个流程从 MCP tool 调用到 Slack 回复都能正确工作。

最后给我一份 Step-by-step 的 Slack 配置文档即可