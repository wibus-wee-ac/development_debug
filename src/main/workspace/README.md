<!-- Once this directory changes, update this README.md -->

# Main/Features/Workspace

Workspace feature 负责工作区记录的产品语义，以及基于工作区根目录的文件清单与安全文本读写规则。
这里拥有 `.gitignore` 过滤、路径越界防护和“从目录快速添加工作区”这类业务语义。
Electron 的目录选择器和 shell 打开能力仍留在 `app/ipc/`，因为那是 transport 层的一跳平台调用。

## Files

- **workspace.ts**: workspace application service 与 DB-backed store，负责 CRUD、文件清单与安全文本读写
- **__tests__/**: workspace feature 的主进程回归测试