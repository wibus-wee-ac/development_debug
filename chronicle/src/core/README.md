# Chronicle Core

`core/` 是 Rust Chronicle 的 composition root。它组合 local store、summary capability 和 optional integration sink，负责把本地事件与 memory manifest 写入 Chronicle state。

Core 不拥有 HTTP route contract，也不构造 Cradle Server client。外部系统只能通过窄 capability 或 integration sink 接入。
