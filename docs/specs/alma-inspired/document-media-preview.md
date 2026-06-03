# 文档与媒体预览

## 目标

Cradle 需要为 chat sessions 和 workspaces 中常见的文档、压缩包、音视频和图片 artifacts 提供安全预览能力。

## Alma 证据

Alma 打包了 `ImagePreview`、`VideoPreview`、`AudioPreview`、`PdfPreview`、`DocxPreview`、`ExcelPreview`、`PptxPreview`、`ZipPreview`、`UnsupportedPreview`，并依赖 `react-pdf`、`mammoth`、`xlsx`、`jszip`。

## Cradle 当前状态

Cradle 文件表面主要是 text、Git diff、workspace file tree、Tiptap editing 和 pack-codebase。没有发现通用 PDF/DOCX/XLSX/PPTX/ZIP/audio/video preview pipeline。

## Owner / Namespace

`apps/web/src/features/file-preview` 拥有 renderer preview components。`workspace` 或 `assets` 拥有安全 file bytes/range serving。解析库按文件类型隔离，并设置 size limits。

## 目标行为

- 用户可以从 workspace files 和 chat artifacts 预览 images、PDF、DOCX、XLSX、PPTX、ZIP、audio、video。
- Unsupported files 显示 metadata 和安全 download/open actions。
- 大文件降级时给出明确限制说明。

## API 草案

- `GET /workspaces/:id/files/preview?path=...`
- `GET /assets/:id/preview`
- `GET /assets/:id/content`

## 数据模型

Preview 本身是 transient。可按 file hash、mime type、size、source owner 缓存 derived metadata。

## 验收

- 预览 PDF 不需要把文件复制到 Cradle storage 外。
- ZIP preview 不把内容解压到任意路径。
- Audio/video controls 可访问，并且不阻塞 chat rendering。
