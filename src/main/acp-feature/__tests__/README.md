<!-- Once this directory changes, update this README.md -->

# Main/Features/ACP/__tests__

这些测试验证 ACP feature 的安装状态流转与 runtime 协调语义。
测试使用注入式 fake dependencies，避免真的下载 agent 或启动 ACP 子进程。

## Files

- **acp.test.ts**: 验证 ACP application service 的 install / uninstall / runtime guard 行为