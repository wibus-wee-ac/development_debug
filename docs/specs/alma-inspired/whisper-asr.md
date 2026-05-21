<!--
Input: Alma Whisper preload/main evidence and Cradle Chronicle audio resource gap.
Output: Spec for local ASR and voice input.
Position: docs/specs/alma-inspired/whisper-asr.md
-->

# Whisper ASR

## 目标

Cradle 需要支持本地 speech-to-text。首要用途是主动语音输入；如果未来接入被动音频感知，则应纳入 Chronicle 的本地音频资源体系。

## Alma 证据

Alma preload 暴露 `whisper.getStatus`、`initialize`、`transcribe`、`dispose`、microphone status、microphone permission request、microphone settings。main process 使用 native Whisper packages，并接收 Float32 audio 做 transcription。

## Cradle 当前状态

Chronicle schema 预留了 `audio-asr`、`audio-vad`、`speaker` model resource categories，但当前成熟路径是 screen capture 与 OCR。未发现 Whisper runtime 或 microphone transcription API。

## Owner / Namespace

主动语音输入归 chat/composer owner。被动音频感知归 Chronicle。若两者共用本地模型生命周期，应由 Chronicle-owned local model resources 统一管理。

## 目标行为

- 用户可以在 composer 中启用 voice input。
- 系统可展示 local model status、download/init state、language、device config。
- Recording 前必须检查 microphone permission。
- Transcription result 可进入 chat draft 或附加到 message provenance。

## API / IPC 草案

- `GET /voice/asr/status`
- `POST /voice/asr/models/:modelId/download`
- `POST /voice/asr/transcribe`
- `desktop.permissions.request('microphone')`

## 数据模型

模型文件应放在 Cradle-owned model root，例如 `~/.cradle/chronicle/models/asr` 或未来 voice namespace。Transcript 默认不持久化，除非附加到用户动作。

## 验收

- Microphone recording 可以在本地转写到 chat composer。
- Denied microphone permission 会阻止 recording，并提供 open settings action。
- Model initialization 失败不会导致 desktop app 崩溃。
