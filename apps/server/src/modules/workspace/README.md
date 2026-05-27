# Workspace Module

Workspace CRUD 与 safe filesystem access，包含 listing、project pinning、text read/write、read-only rich preview bytes/renditions、create file/folder 和 rename path。
Workspace module 也拥有 Cradle 创建的 ad-hoc chat workspaces。当 session 创建时没有用户选择的项目，session module 会请求 workspace module 在 `~/Documents/Cradle/YYYY-MM-DD/<timestamp-id>` 下创建日期目录，并把它保存为普通 workspace record，让 runtime 仍然从具体 workspace path 启动。
Route metadata 包含用于 generated CLI commands 的 `x-cradle-cli` descriptors。
Workspace file writes 是 non-Cradle-owned writes，因为目标文件位于用户 workspace directories。Write route 要求 `confirmedNonCradleOwnedWrite: true`，并返回命名 workspace boundary 与 target path 的 `ownerBoundary` metadata。
Rich preview routes 是 read-only：`/files/info` 返回类型与 preview kind，先按已知扩展/文件名分类，再对未知类型读取文件头部做文本嗅探，避免代码文件被误判为 `application/octet-stream`；`/files/raw` 返回 workspace 文件 bytes；`/files/rendition/pdf` 返回原生 PDF 或 Office-to-PDF rendition。Office rendition cache 位于 Cradle server data namespace 下的 `workspace/renditions`，不会写回用户 workspace。Office-to-PDF 依赖本机 LibreOffice/soffice；未安装时 route 返回 rendition failure。

## Files

- **index.ts**: Elysia `/workspaces` routes、OpenAPI metadata、generated CLI descriptors、workspace pin update、read-only preview routes，以及 workspace file write/create/rename confirmation contract。
- **model.ts**: Workspace requests、responses、pinning fields、rich preview metadata、file operation payloads 和 owner-boundary metadata 的 TypeBox schemas。
- **service.ts**: Workspace CRUD and pinned-first listing semantics、ad-hoc chat workspace directory creation、read-only rich preview/rendition orchestration，以及 explicit non-Cradle-owned file write/create/rename confirmation enforcement。
- **files.ts**: `.gitignore` filtering、preview metadata detection with text sniffing、safe text/binary IO、Office-to-PDF rendition cache、safe create/rename operations、workspace path resolution 和 owner-boundary payload construction。
