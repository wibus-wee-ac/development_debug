<!-- Once this directory changes, update this README.md -->

# Main/Platform/PTY

PTY platform bucket 负责 shell/terminal 子进程的生命周期与 renderer 推送。
它为聊天与终端场景提供统一的 PTY 运行时抽象。
把 PTY plumbing 放在这里，而不是散落到 app/ipc 或窗口逻辑中。

## Files

- **pty-manager.ts**: PTY 会话创建、写入、尺寸调整、退出与推送订阅管理
