<!-- Once this directory changes, update this README.md -->

# Main/Platform

`platform/` 承载 ACP、窗口、PTY、socket、storage、resources 等系统/运行时适配能力。
这些模块处理协议、OS、进程与资源层面的复杂性，不拥有上层业务语义。
新增系统桥接或运行时 plumbing 时，优先放在这里而不是 feature 或 app glue。

## Files

- **acp/**: ACP registry、安装、进程与协议 transport 能力
- **pty/**: PTY 会话管理与 renderer 推送
- **resources/**: 打包资源路径与读取 helpers
- **socket/**: CLI 访问使用的 Unix domain socket server
- **storage/**: OS-backed safe storage 等敏感数据适配
- **window/**: 主窗口与 tear-off 窗口的显示策略、激活与管理
