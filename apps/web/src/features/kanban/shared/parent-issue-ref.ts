/**
 * Output: Lightweight parent issue reference used by Kanban item surfaces.
 * Input: Issue-owned parent relationship data resolved from the workspace issue list.
 * Position: Shared Kanban metadata type for card and list rendering.
 */

export interface ParentIssueRef {
  id: string
  key: string
}
