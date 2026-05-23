# Chronicle Store

`store/` 负责 Chronicle 的本地可检查状态：

- `events.ndjson`: append-only local event journal。
- `memory-manifest.json`: memory files 的可读索引。

Store 不替代 artifact 文件；它只记录指向 capture、audio、transcript 和 memory 输出的本地索引。
