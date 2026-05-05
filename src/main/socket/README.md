<!-- Once this directory changes, update this README.md -->

# Main/Platform/Socket

Socket platform bucket 负责 CLI 访问主进程时使用的 socket server。
它为 app bootstrap 提供独立的本地进程通信入口。
把 CLI socket transport 放在这里，而不是混入 feature 逻辑。

## Files

- **socket-server.ts**: 本地 socket server 的启动、停止与请求分发
