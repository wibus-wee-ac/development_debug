<!-- Once this directory changes, update this README.md -->

# Main/Platform/Storage

Storage platform bucket 负责主进程对 OS-backed 持久化能力的适配。
它为凭证等敏感数据提供统一加密边界。
把底层 secret storage 逻辑集中在这里。

## Files

- **safe-storage.ts**: 基于 Electron `safeStorage` 的凭证加密与解密 helpers
