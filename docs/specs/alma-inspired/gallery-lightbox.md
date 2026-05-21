<!--
Input: Alma gallery/lightbox renderer evidence and Cradle asset gap.
Output: Spec for gallery and lightbox.
Position: docs/specs/alma-inspired/gallery-lightbox.md
-->

# Gallery And Lightbox

## Goal

Cradle should provide a unified image asset browsing and inspection surface for generated images, uploaded images, workspace images, and chat artifacts.

## Alma Evidence

Alma has `gallery.html`, `lightbox.html`, `galleryWindow`, `lightboxWindow`, a masonry gallery, paginated `/api/gallery/images`, copy/save actions, zoom/pan, keyboard navigation, and thread navigation.

## Cradle Current State

Cradle has workspace files and chat messages, but no dedicated image gallery or lightbox.

## Target Ownership

A future `assets` or `gallery` server module owns image asset records and source links. Web owns gallery and lightbox UI. Desktop only owns optional secondary window lifecycle.

## Target Behavior

- Image assets are indexed with source owner, source id, created time, mime type, dimensions, and storage pointer.
- Gallery supports pagination, filtering by workspace/session/source, and opening a lightbox.
- Lightbox supports copy, save, zoom, pan, keyboard navigation, and jump back to source.

## API Sketch

- `GET /assets/images?workspaceId=&sessionId=&limit=&offset=`
- `GET /assets/images/:id`
- `GET /assets/images/:id/content`

## Data Model

`image_assets` should reference owning source records without taking lifecycle ownership. Deleting a source can tombstone or detach according to that owner policy.

## Acceptance

- A chat-generated image appears in the gallery with a source link.
- Lightbox navigation loads additional pages near list boundaries.
- Deleting a workspace does not leave inaccessible image records.
