<!-- Once this directory changes, update this README.md -->

# Features/Devtool/Resources

AppHeader resource popover for lightweight runtime diagnostics.

## Files

- **resources-popover.tsx**: ResourcesPopover trigger and popover content; samples renderer memory, server health, and terminal resource snapshots, exposes accessible trigger/refresh controls, then surfaces partial endpoint failures instead of silently showing zero values.
- **resources-popover.test.tsx**: Tests snapshot warning normalization, visible partial-failure feedback, compact terminal labels, and accessible trigger/refresh actions.
