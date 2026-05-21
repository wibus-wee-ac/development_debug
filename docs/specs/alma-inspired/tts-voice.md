<!--
Input: Alma TTS settings/API evidence and Cradle voice gap.
Output: Spec for TTS and voice replies.
Position: docs/specs/alma-inspired/tts-voice.md
-->

# TTS And Voice Replies

## Goal

Cradle should support controlled text-to-speech generation for user-facing playback and external channel voice replies where channel owners opt in.

## Alma Evidence

Alma exposes TTS settings for local Qwen3-TTS, ElevenLabs, and OpenAI, includes setup/model download progress, voice selection, test voice, `/api/tts/generate`, `/api/tts/setup`, and bot voice reply behavior.

## Cradle Current State

No TTS settings, voice reply pipeline, audio output module, or channel-specific voice response flow was found.

## Target Ownership

A future `voice` module owns TTS generation jobs and model/provider config. External channel connectors own whether a text response should be sent as voice. Provider secrets remain in `secrets`.

## Target Behavior

- Users can configure TTS provider, model, voice, and output format.
- Users can generate a preview voice clip from settings.
- Channel bridges may request voice output for replies.
- Generated audio files have explicit lifecycle and cleanup.

## API Sketch

- `GET /voice/tts/config`
- `PUT /voice/tts/config`
- `POST /voice/tts/test`
- `POST /voice/tts/generate`

## Data Model

Persist TTS config in preferences or a voice-owned table. Generated audio artifacts should be short-lived unless attached to a channel message or asset record.

## Acceptance

- Test voice generation returns an audio artifact and structured provider errors.
- Disabling TTS prevents channel voice reply generation.
- Generated temp audio is cleaned up after retention expires.
