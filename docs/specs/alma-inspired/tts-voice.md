# TTS 与 Voice Replies

## 目标

Cradle 需要支持受控 text-to-speech generation，用于本地播放和外部 channel 的 voice reply。是否启用 voice reply 由 channel owner 决定。

## Alma 证据

Alma 提供 local Qwen3-TTS、ElevenLabs、OpenAI 的 TTS settings，包含 setup/model download progress、voice selection、test voice、`/api/tts/generate`、`/api/tts/setup`，并在 bot bridge 中支持 voice reply。

## Cradle 当前状态

未发现 TTS settings、voice reply pipeline、audio output module 或 channel-specific voice response flow。

## Owner / Namespace

未来 `voice` module 拥有 TTS generation jobs 与 model/provider config。外部 channel connector 拥有“是否把文本回复转成语音发送”的决策。Provider secrets 继续归 `secrets`。

## 目标行为

- 用户可以配置 TTS provider、model、voice、output format。
- 用户可以在 settings 中生成 test voice。
- Channel bridge 可以请求 voice output。
- Generated audio files 有明确 lifecycle 和 cleanup。

## API 草案

- `GET /voice/tts/config`
- `PUT /voice/tts/config`
- `POST /voice/tts/test`
- `POST /voice/tts/generate`

## 数据模型

TTS config 可以放在 preferences 或 voice-owned table。Generated audio artifacts 默认短期保留，除非被 channel message 或 asset record 引用。

## 验收

- Test voice generation 返回 audio artifact，并能返回结构化 provider errors。
- 禁用 TTS 后 channel voice reply generation 不再执行。
- Temporary audio 到期后被清理。
