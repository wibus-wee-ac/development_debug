<!-- Once this directory changes, update this README.md -->

# Main/Features/Skills/__tests__

这些测试验证 skills inventory 的扫描、选择与写入边界。
它们保障 filesystem-first 语义不会被回退成配置开关式实现。
修改 skills source 或 inventory contract 时，应先更新这里。

## Files

- **skills.test.ts**: 验证 skills inventory 的多层扫描、缓存复用/失效，以及写入行为
