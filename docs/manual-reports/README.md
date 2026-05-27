<!--
Output: Manual investigation report inventory.
Input: Ad-hoc debugging, verification, and diagnosis notes requested during development.
Position: docs/manual-reports records evidence-backed findings that are not execution plans.
-->

# Manual Reports

这个目录保存一次性的人工诊断、验证和调研报告。它不同于 `docs/exec-plans/`：这里记录当前证据、原因判断和建议方案，不负责承诺实施步骤。

## Files

- **2026-05-06-01-e2e-report.md**: Cradle E2E 测试改进报告，覆盖早期端到端测试覆盖度审计、整改状态和后续缺口。
- **2026-05-27-01-desktop-migration-diagnosis.md**: Desktop SQLite migration 缺表诊断，解释 `model_registry_mappings` 报错原因、当前 DB 状态和推荐修复路径。
