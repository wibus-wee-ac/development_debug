<!-- Once this directory changes, update this README.md -->

# src/main

主进程入口层负责注册 IPC、装配服务，并定义主进程与渲染进程共享的公共类型。
这里不放复杂业务逻辑，具体能力下沉到 `lib/` 与 `services/`。
新增主进程能力时，先扩展类型与 service，再从入口装配。
跨领域编排优先放入 `application/`，生命周期联动优先通过 `events/` 显式建模。

## Files

- **index.ts**: Electron 主进程入口，负责窗口生命周期、IPC 注册与服务装配
- **ipc-types.ts**: 主进程与渲染进程共享的 IPC 类型导出层
