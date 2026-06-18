import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "preferences",
    "set"
  ],
  "description": "Update diff review preferences",
  "flags": [
    {
      "name": "diffStyle",
      "required": false,
      "target": "body.diffStyle",
      "type": "string",
      "values": [
        "split",
        "unified"
      ]
    },
    {
      "name": "codeTheme",
      "required": false,
      "target": "body.codeTheme",
      "type": "string"
    },
    {
      "name": "fontSize",
      "required": false,
      "target": "body.fontSize",
      "type": "number"
    },
    {
      "name": "lineHeight",
      "required": false,
      "target": "body.lineHeight",
      "type": "number"
    },
    {
      "name": "hideWhitespaceOnly",
      "required": false,
      "target": "body.hideWhitespaceOnly",
      "type": "boolean"
    },
    {
      "name": "structuralHighlighting",
      "required": false,
      "target": "body.structuralHighlighting",
      "type": "boolean"
    },
    {
      "name": "collapseGeneratedFiles",
      "required": false,
      "target": "body.collapseGeneratedFiles",
      "type": "boolean"
    },
    {
      "name": "notificationMode",
      "required": false,
      "target": "body.notificationMode",
      "type": "string",
      "values": [
        "all-activity",
        "all-activity-by-people",
        "reviews-and-comments",
        "reviews-and-comments-by-people",
        "none"
      ]
    }
  ],
  "method": "put",
  "path": "/workspaces/{id}/diff-reviews/preferences"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
