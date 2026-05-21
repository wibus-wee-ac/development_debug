<!--
Input: Alma preview chunk evidence and Cradle workspace/file audit.
Output: Spec for document and media preview.
Position: docs/specs/alma-inspired/document-media-preview.md
-->

# Document And Media Preview

## Goal

Cradle should provide safe previews for common document and media artifacts encountered in chat sessions and workspaces.

## Alma Evidence

Alma bundles `ImagePreview`, `VideoPreview`, `AudioPreview`, `PdfPreview`, `DocxPreview`, `ExcelPreview`, `PptxPreview`, `ZipPreview`, and `UnsupportedPreview`. It depends on `react-pdf`, `mammoth`, `xlsx`, and `jszip`.

## Cradle Current State

Cradle file surfaces focus on text, Git diff, workspace file trees, Tiptap editing, and pack-codebase. No broad PDF/DOCX/XLSX/PPTX/ZIP/audio/video preview pipeline was found.

## Target Ownership

`apps/web/src/features/file-preview` owns renderer preview components. `workspace` or `assets` owns safe file bytes/range serving. Parsing libraries must be isolated by file type and size limits.

## Target Behavior

- Users can preview images, PDF, DOCX, XLSX, PPTX, ZIP, audio, and video from workspace files and chat artifacts.
- Unsupported files show metadata and safe download/open actions.
- Large files degrade gracefully with clear limits.

## API Sketch

- `GET /workspaces/:id/files/preview?path=...`
- `GET /assets/:id/preview`
- `GET /assets/:id/content`

## Data Model

Preview itself is transient. Optional derived metadata can be cached by file hash, mime type, size, and source owner.

## Acceptance

- Previewing a PDF does not require copying it outside Cradle storage.
- ZIP preview does not extract files to arbitrary paths.
- Audio/video controls remain accessible and do not block chat rendering.
