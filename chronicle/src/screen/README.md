# Chronicle Screen

屏幕与外部观测输入边界。当前实现包含 macOS native provider、inbox provider 与 synthetic smoke source。macOS provider 默认枚举并采集所有 active displays。

## Files

- `mod.rs`: 定义 `CaptureSource`、`CapturedFrame` 与 `BrowserWindowObservation`。
- `macos.rs`: 使用 macOS CoreGraphics active display capture、CoreGraphics window inventory 与 Vision OCR 获取真实屏幕帧。
- `inbox.rs`: 从外部进程写入的 inbox manifest 中读取 capture frame。
- `synthetic.rs`: tests 与 smoke runs 使用的 deterministic synthetic capture source。
- `privacy_filter.rs`: platform-neutral privacy-sensitive window detection。
