<!-- Once this directory changes, update this README.md -->

# Main/Features/Workspace/__tests__

这些测试验证 workspace feature 的产品语义，而不是 IPC transport 本身。
它们覆盖 workspace 记录委派、`.gitignore` 文件过滤，以及相对路径读写时的越界防护。

## Files

- **workspace.test.ts**: 验证 workspace application service 的 CRUD、文件清单过滤与安全文本读写行为