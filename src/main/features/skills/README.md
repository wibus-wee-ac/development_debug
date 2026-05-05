<!-- Once this directory changes, update this README.md -->

# Main/Features/Skills

Skills feature 负责 filesystem-first skills inventory、CRUD 与远程 source 抓取。
这些模块被 `SkillsService` 与 `ChatEngine` 复用，统一管理 built-in、legacy、global、workspace、agent 五层来源。
把 skills 文件系统规则放在这里；不要把 skills 数据写回其他产品的 namespace。

## Files

- **skill-source.ts**: 解析远程或本地 source、clone 仓库并发现 skill package
- **skills.ts**: Filesystem-first skills 库，负责五层扫描、CRUD 与导入导出
- **__tests__/**: skills feature 的主进程回归测试
