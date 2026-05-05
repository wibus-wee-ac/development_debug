<!-- Once this directory changes, update this README.md -->

# Main/Features/ACP

ACP feature 负责 ACP registry、安装状态、审计查询、auto-created agent profile，以及 runtime session 协调的产品语义。
这里拥有 ACP 的安装/卸载编排与安装状态持久化；底层下载、解压、进程与协议 transport 仍由 `platform/acp/` 负责。

## Files

- **acp.ts**: ACP application service 与 DB-backed store，负责 registry、安装生命周期、runtime session 与 auto-profile 同步
- **__tests__/**: ACP feature 的主进程回归测试