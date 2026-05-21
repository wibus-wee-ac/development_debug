# Remove Header Comments Scope - ExplorationB

## Scope

本节点只验证 `packages/`、`plugins/`、`chronicle/` 下的 code-file 匹配范围。已读取 Plan File：`docs/exec-plans/20260521-06-remove-file-header-comments.md`。

本节点未编辑源码文件。唯一输出是本文档。

## Direct Conclusion

在限定路径和 code extensions 内，匹配不是只有最简单的 line 1-3 文件头；主要仍是 exact three-line metadata header，但存在位置变体：

- 183 个文件是第 1-3 行的 exact three-line header。
- 1 个文件是 shebang 后第 2-4 行的 exact three-line header。
- 6 个文件是文件开头指令注释后第 3-5 行的 exact three-line header。
- 1 个文件包含自身第 1-3 行 header，且还在生成器模板字符串内部包含 header 文本。

未发现标签格式变体：宽松空白搜索与 exact 搜索数量一致，说明没有额外的缩进、标签空格、或 `#` / block comment 形式变体。

## Commands Run

```bash
sed -n '1,260p' docs/exec-plans/20260521-06-remove-file-header-comments.md
rg -n "^// (Input|Output|Position):" packages plugins chronicle --glob "*.ts" --glob "*.tsx" --glob "*.js" --glob "*.jsx" --glob "*.mjs" --glob "*.cjs" --glob "*.rs" --glob "*.go" --glob "!**/node_modules/**" --glob "!**/dist/**" --glob "!**/target/**" --glob "!**/build/**" --glob "!**/coverage/**"
rg -n "^\s*//\s*(Input|Output|Position)\s*:" packages plugins chronicle --glob "*.ts" --glob "*.tsx" --glob "*.js" --glob "*.jsx" --glob "*.mjs" --glob "*.cjs" --glob "*.rs" --glob "*.go" --glob "!**/node_modules/**" --glob "!**/dist/**" --glob "!**/target/**" --glob "!**/build/**" --glob "!**/coverage/**"
rg -n "^(//|#|/\*)\s*(Input|Output|Position)\s*:" packages plugins chronicle --glob "*.ts" --glob "*.tsx" --glob "*.js" --glob "*.jsx" --glob "*.mjs" --glob "*.cjs" --glob "*.rs" --glob "*.go" --glob "!**/node_modules/**" --glob "!**/dist/**" --glob "!**/target/**" --glob "!**/build/**" --glob "!**/coverage/**"
```

## Search Results

Exact label-line search:

- 577 matching lines.
- 191 matching files.

Flexible whitespace search:

- 577 matching lines.
- No additional variants beyond the exact form.

Alternate comment prefix search:

- 577 matching lines.
- No `# Input:` or block-comment variants in the searched code-file set.

File ownership distribution:

- `packages/cli`: 148 files.
- `packages/tabs-next`: 19 files.
- `packages/db`: 16 files.
- `packages/ipc`: 7 files.
- `plugins/browser-use`: 1 file.
- `chronicle`: 0 files.

## Shape Classification

Classification by line positions of exact matching labels:

- `line1`: 183 files with matches at lines `1,2,3`.
- `shebang`: 1 file with matches at lines `2,3,4`.
- `directive`: 6 files with matches at lines `3,4,5`.
- `other`: 1 file with matches at lines `1,2,3,192,193,216,217`.

The labels themselves are exact in every case. The only variants are placement and generated-template occurrences.

## Placement Variants

Shebang-preserving cleanup is needed for:

- `packages/cli/src/index.ts`

Directive-preserving cleanup is needed for:

- `packages/tabs-next/src/__tests__/persisted-contexts.test.ts`
- `packages/tabs-next/src/__tests__/tab-bar.test.tsx`
- `packages/tabs-next/src/__tests__/tab-link.test.tsx`
- `packages/tabs-next/src/__tests__/url-sync.test.ts`
- `packages/tabs-next/src/__tests__/use-tab-navigation.test.tsx`
- `packages/tabs-next/src/components/tab-renderer.tsx`

Examples observed:

- `packages/cli/src/index.ts` starts with `#!/usr/bin/env tsx`, then the three metadata lines.
- `packages/tabs-next/src/__tests__/tab-bar.test.tsx` starts with `// @vitest-environment jsdom`, then a blank `//`, then the three metadata lines.
- `packages/tabs-next/src/components/tab-renderer.tsx` starts with an ESLint disable block comment, then the three metadata lines.

## Template Occurrence

`packages/cli/scripts/generate-cli.ts` is the only file that has more than one metadata-header group:

- Its own file header appears at lines `1,2,3`.
- `renderCommandModule()` contains generated module header text at lines `192,193`; the corresponding `Input` line is embedded in the same template literal opening line before line 192.
- `renderIndex()` contains generated barrel header text at lines `216,217`; the corresponding `Input` line is embedded in the same template literal opening line before line 216.

Cleanup should update this generator template as well if the intent is that regenerated CLI command files do not reintroduce the metadata headers. A line-position-only remover that only deletes top-of-file headers will leave the generator able to recreate the removed comments.

## Notable Scope Details

Generated CLI command files under `packages/cli/src/commands/generated/**` make up most of the matches. Removing the generated files' current headers without changing `packages/cli/scripts/generate-cli.ts` would make the cleanup non-idempotent after regeneration.

No matches were found under `chronicle/` after excluding `target/`.

No searched matches came from `plugins/system-info/`.

## Recommended Follow-Up

For this scope, the cleanup pass should:

1. Remove exact three-line metadata headers at the first code-file metadata block.
2. Preserve shebang lines and file-level tool directives.
3. Remove or update the generated header template literals in `packages/cli/scripts/generate-cli.ts`.
4. Re-run the scoped validation command over `packages plugins chronicle` with the same code-file globs.

## Blockers

None.
