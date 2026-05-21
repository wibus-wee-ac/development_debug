<!--
Input: Alma Whisper preload/main evidence and Cradle Chronicle audio resource gap.
Output: Spec for local ASR and voice input.
Position: docs/specs/alma-inspired/whisper-asr.md
-->

# Whisper ASR

## Goal

Cradle should support local speech-to-text for active voice input and, if adopted later, passive Chronicle audio resources.

## Alma Evidence

Alma preload exposes `whisper.getStatus`, `initialize`, `transcribe`, `dispose`, microphone status, microphone permission request, and microphone settings. Main process uses native Whisper packages and accepts Float32 audio for transcription.

## Cradle Current State

Chronicle schema reserves `audio-asr`, `audio-vad`, and `speaker` model resource categories, but current evidence shows screen capture and OCR as the mature path. No Whisper runtime or microphone transcription API was found.

## Target Ownership

Active voice input belongs to chat/composer owner. Passive audio sensing belongs to Chronicle. Shared local model lifecycle should live under Chronicle-owned local model resources if both owners need it.

## Target Behavior

- Users can enable voice input from the composer.
- The system exposes local model status, download/init state, language, and device configuration.
- Microphone permission is checked before recording.
- Transcription results attach to normal chat drafts or messages.

## API / IPC Sketch

- `GET /voice/asr/status`
- `POST /voice/asr/models/:modelId/download`
- `POST /voice/asr/transcribe`
- `desktop.permissions.request('microphone')`

## Data Model

Model files should live under a Cradle-owned model resource root such as `~/.cradle/chronicle/models/asr` or a future voice namespace. Transcripts should only persist when attached to a user action.

## Acceptance

- A microphone recording can be transcribed into the chat composer without sending audio to a remote provider.
- Denied microphone permission blocks recording with an actionable settings link.
- Model initialization failures do not crash the desktop app.
