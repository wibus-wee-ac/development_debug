<!--
Input: Alma gallery/lightbox renderer evidence and Cradle asset gap.
Output: Spec for gallery and lightbox.
Position: docs/specs/alma-inspired/gallery-lightbox.md
-->

# Gallery 与 Lightbox

## 目标

Cradle 需要统一浏览和检查 image assets，包括生成图片、上传图片、workspace images 和 chat artifacts。

## Alma 证据

Alma 有 `gallery.html`、`lightbox.html`、`galleryWindow`、`lightboxWindow`、masonry gallery、paginated `/api/gallery/images`、copy/save actions、zoom/pan、keyboard navigation 和 thread navigation。

## Cradle 当前状态

Cradle 有 workspace files 和 chat messages，但没有专用 image gallery 或 lightbox。

## Owner / Namespace

未来 `assets` 或 `gallery` server module 拥有 image asset records 和 source links。Web 拥有 gallery/lightbox UI。Desktop 只拥有可选二级窗口 lifecycle。

## 目标行为

- Image assets 记录 source owner、source id、created time、mime type、dimensions、storage pointer。
- Gallery 支持分页、按 workspace/session/source 过滤、打开 lightbox。
- Lightbox 支持 copy、save、zoom、pan、keyboard navigation、jump back to source。

## API 草案

- `GET /assets/images?workspaceId=&sessionId=&limit=&offset=`
- `GET /assets/images/:id`
- `GET /assets/images/:id/content`

## 数据模型

`image_assets` 引用 source records，但不接管 source lifecycle。删除 source 时按 owner policy tombstone 或 detach。

## 验收

- Chat-generated image 会带 source link 出现在 gallery。
- Lightbox 接近列表边界时可以继续加载分页。
- 删除 workspace 后不会留下不可访问 image records。
