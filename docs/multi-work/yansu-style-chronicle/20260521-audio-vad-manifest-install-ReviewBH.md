# Audio VAD Manifest Install ReviewBH

## 结论

无 blocking findings。

当前实现已经解除 `audio-vad` manifest install 的 unverified manifest safety gate 阻塞：`audio-vad/silero_vad.onnx` 具备 `sourceUrl`、`sha256` 和 `sizeBytes`，因此会进入下载路径而不是被 `chronicle_model_resource_manifest_unverified` 拒绝。生产路径仍然在 promotion 前执行 size 与 checksum 校验，并且目标路径固定在 Chronicle-owned model namespace。

我运行了：

```text
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
```

结果：1 个 test file / 1 个 test 通过。

## Findings

### Medium: 测试只证明了 size gate，没有真正覆盖 checksum gate

- `apps/server/tests/chronicle.test.ts:603`
- `apps/server/tests/chronicle.test.ts:615`
- `apps/server/src/modules/chronicle/service.ts:5067`
- `apps/server/src/modules/chronicle/service.ts:5070`

测试里的 corrupt local VAD fixture 是 `Buffer.from('fake-vad-model')`，长度明显不是 manifest 期望的 `643_854` bytes。因此 `verifyStagedModelFile()` 会先在 size check 失败，无法执行后面的 sha256 分支。也就是说，当前测试能证明 corrupt local bytes 不会 promotion，并证明 size enforcement 生效；但如果未来有人移除了 `file.sha256` 校验而保留 size check，这个测试仍然会通过。

建议后续补一个同样不依赖 live network 的 case：写入长度正好为 `643_854`、但 sha256 不匹配的 local source file，断言返回 `status: 'error'`、message 包含 `Checksum failed for audio-vad/silero_vad.onnx`，并且 `CRADLE_DATA_DIR/chronicle/models/audio-vad/silero_vad.onnx` 不存在。

## Verified

- Safety gate 已不再阻塞 `audio-vad` manifest install：`apps/server/src/modules/chronicle/service.ts:269` 到 `apps/server/src/modules/chronicle/service.ts:272` 为 VAD manifest 提供了 `sourceUrl`、`sha256`、`sizeBytes`；`apps/server/src/modules/chronicle/service.ts:1464` 到 `apps/server/src/modules/chronicle/service.ts:1466` 只对 manifest source 执行安全门；`apps/server/src/modules/chronicle/service.ts:4995` 到 `apps/server/src/modules/chronicle/service.ts:5002` 的 gate 要求已经满足。
- 测试证明 install request 到达下载路径且不依赖 live network：`apps/server/tests/chronicle.test.ts:586` 到 `apps/server/tests/chronicle.test.ts:599` mock 了 `globalThis.fetch` 的 502 response，并断言 fetch 被调用到真实 VAD URL，同时响应 message 不包含旧的 manifest safety gate 文案。
- Promotion 前仍有完整性校验：`apps/server/src/modules/chronicle/service.ts:1491` 到 `apps/server/src/modules/chronicle/service.ts:1500` 无论 local copy 还是 remote download 都先写入 temp path，然后调用 `verifyStagedModelFile()`；`apps/server/src/modules/chronicle/service.ts:1503` 到 `apps/server/src/modules/chronicle/service.ts:1505` 只在所有 staged files 校验完成后 rename 到目标路径。
- 校验逻辑同时包含 size 与 checksum：`apps/server/src/modules/chronicle/service.ts:5062` 到 `apps/server/src/modules/chronicle/service.ts:5075` 先检查 file，再检查 `sizeBytes`，然后在 manifest 提供 `sha256` 时计算并比较 digest。
- Model files 保持在 Chronicle-owned namespace：`apps/server/src/modules/chronicle/service.ts:4928` 到 `apps/server/src/modules/chronicle/service.ts:4934` 使用 `CRADLE_DATA_DIR/chronicle/models` 或 `~/.cradle/chronicle/models`；`apps/server/src/modules/chronicle/service.ts:4936` 到 `apps/server/src/modules/chronicle/service.ts:4947` 拒绝逃逸 root 的 target path。测试在 `apps/server/tests/chronicle.test.ts:617` 到 `apps/server/tests/chronicle.test.ts:619` 断言 models root 是 `dataDir/chronicle/models`，且不会写到 capture `storageRoot/models`。
- README 的 ownership 说明与实现一致：`apps/server/src/modules/chronicle/README.md:18` 明确 model resources 属于 Chronicle namespace，不跟随 capture `storageRoot`，provider profiles 也不拥有资源生命周期。

## Residual Risk

`apps/server/src/modules/chronicle/README.md:20` 写的是 manifest URL 下载会在“落盘前”校验 checksum/size。按当前实现，bytes 会先写入 staging temp file，再在 promotion 到最终 model path 前校验。语义上符合“promotion 前校验”，但如果严格理解为“任何磁盘写入前”，这句话可以更精确地改成“promotion 到最终模型路径前校验 checksum/size”。
