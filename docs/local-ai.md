# Local AI and BYOK

Pinar's local server can run the five AI-assisted workflows—session summaries,
pin diagnosis, component export, reproduction generation, and design-system
extraction—through an OpenAI-compatible endpoint.

Open **Settings → AI** in the local Pinar app and choose:

- **Local AI** for a server on the same machine, such as Ollama or LM Studio.
  Enter its OpenAI-compatible base URL (for example,
  `http://127.0.0.1:11434/v1`) and the exact model ID exposed by that server.
- **BYOK** for a remote OpenAI-compatible provider. Enter its base URL, model
  ID, and API key. Provider billing applies directly; Pinar credits are not
  used.

Optionally, enter a **transcription model** to enable voice comments in the
Chrome extension while it stores captures locally. Leave it empty to keep voice
comments off in local mode.

Pinar checks the endpoint and confirms that the selected model appears in its
`/models` response before saving. Authentication, endpoint, timeout, malformed
response, and missing-model failures are reported separately.

## Voice comments

With a transcription model configured, the extension sends the recorded audio
to the local server (`POST /api/ai/voice-pin`), which forwards it to the
provider's `POST /v1/audio/transcriptions` endpoint as multipart form data
(`file`, `model`, and `language`). Recordings are limited to 120 seconds and
5 MiB, are kept in request memory only, and are never written to disk.

When **Clean up transcription with AI** is on in the extension options, the
transcript is then rewritten into a comment and acceptance criteria by the
chat model. Otherwise the raw transcript becomes the comment. Local voice
comments do not use Pinar credits.

## Privacy and credentials

Local AI and BYOK are available only while the local Pinar server is active.
Requests go directly from that server to the configured endpoint. There is no
silent fallback to Pinar Cloud.

The endpoint, model, and mode are stored in `~/.pinar/ai.json`. API keys are
never stored there or in `preferences.json`: macOS uses Keychain, Windows uses
Credential Manager, and Linux uses the Secret Service through `secret-tool`.

## Model requirements and limitations

The endpoint must implement OpenAI-compatible `GET /v1/models` and
`POST /v1/chat/completions`. Voice comments also need
`POST /v1/audio/transcriptions`. The selected model should follow system prompts,
support the requested context size, and reliably produce JSON when asked.
Component export also needs long structured text output. Small or heavily
quantized models can return invalid JSON, incomplete components, weak visual
diagnoses, or lower-quality reproduction tests. Pinar reports these as invalid
responses and does not switch providers automatically.
