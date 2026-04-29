# nChar Minutes

A privacy-focused fork of [Char](https://github.com/fastrepl/char) (formerly Hyprnote) optimized for local Apple Silicon AI workflows.

**Developer:** Torbjörn E. M. Nordling ([github.com/temn](https://github.com/temn))

All changes in this fork are licensed under **GPL-3.0**, same as the original project.

If you like this fork, a star on GitHub would make me smile.

## Why this fork exists

### 1. Local Apple Silicon AI

Char v1.0.20 replaced the local MLX-Whisper speech-to-text system with Parakeet V3 + Whisper Small (batch-only). This fork restores real-time local transcription via MLX-Whisper and adds local LLM models for writing minutes.

### 2. Better minutes output

The upstream summary templates abstract away discussion details.
nChar includes templates that preserve what was actually said — with speaker attribution, decision context, and actionable todo items that include the reasoning behind each task.

### 3. Complete privacy

The upstream Char app contacts external servers for analytics, error reporting, update checking, and account management:

| Service | Data sent | How it's disabled in nChar |
|---------|-----------|---------------------------|
| **PostHog** analytics | Events, device fingerprint, email, settings changes | No `POSTHOG_API_KEY` at build time |
| **Sentry** error reporting | Exceptions, stack traces, device fingerprint, app logs | No `SENTRY_DSN` / `VITE_SENTRY_DSN` at build time |
| **Supabase** auth | Email, password, session tokens, subscription status | No `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |
| **Honeycomb** tracing | Request traces, device fingerprint | No `HONEYCOMB_API_KEY` |
| **Update checker** | App version, platform, architecture | Updater plugin disabled |
| **Device fingerprint** | Unique machine identifier in `x-device-fingerprint` header | No API calls to `api.char.com` |
| **Feedback submission** | Error messages, device info, app logs | No API endpoint configured |

**nChar Minutes sends zero data to any external server** unless you explicitly configure a cloud AI provider (Claude, Codex, Gemini, OpenAI, etc.) — in which case only the transcript data you choose to send reaches that provider's API.

No account creation. No onboarding. No telemetry. No update pings. Your meetings stay on your machine.

### What nChar adds

- **MLX-Whisper STT** — Real-time local transcription using Apple Silicon Metal GPU (2-5x faster than standard Whisper)
- **4 local MLX LLM models** — For writing minutes, summaries, and action items without cloud APIs
- **Improved minutes templates** — Detailed minutes with speaker attribution, decisions, and contextual action items
- **CLI AI export** — Pipe transcripts to Claude, Codex, or Gemini CLI tools via tmux
- **Model fallback** — Automatic fallback across local models when the selected one is unavailable
- **Privacy hardening** — All external telemetry, analytics, and update checking disabled


## Acknowledgments

Thank you to the [fastrepl](https://github.com/fastrepl) team for building Char — a thoughtful, well-architected open-source meeting notes app. This fork exists because of their excellent plugin-based design that makes extensions like these possible. All original copyrights and the GPL-3.0 license are preserved.

## Installation and usage

### Quickstart (macOS Tahoe, Apple Silicon)

```bash
# 1. Install prerequisites
xcode-select --install
brew install node@22 rust pnpm cmake

# 2. Clone and build
git clone https://github.com/temn/nchar-minutes.git
cd nchar-minutes
git checkout nchar-main
pnpm install
pnpm -F @hypr/ui build        # generates Tailwind CSS (required before first run)
pnpm -F @hypr/desktop tauri:dev
```

The app will launch in development mode. No account creation or internet connection required — skip any onboarding prompts and go straight to Settings > AI to configure a local model.

### Minimal local setup

To take meeting notes with fully local AI (no internet):

1. Install one MLX writing model (see [Installation of local MLX models](#installation-of-local-mlx-models) below)
2. Start the model server: `mlx_lm.server --model mlx-community/Qwen3-VL-8B-Thinking-4bit --port 8082`
3. Launch nChar: `pnpm -F @hypr/desktop tauri:dev`
4. Go to Settings > AI > LLM > select "MLX Local" > pick the available model
5. Record a meeting, then click Enhance to generate minutes

For transcription, you can use any of the built-in STT providers or set up MLX-Whisper locally.

### Local MLX models

These models are optimized for writing meeting minutes and summaries on Apple Silicon. They are selected based on [WritingBench](https://arxiv.org/abs/2503.05244) scores — the most comprehensive benchmark for English text quality.

| Port | Model | Category | WritingBench | RAM | MLX Repo |
|------|-------|----------|-------------|-----|----------|
| 8080 | Qwen3-Next-80B-A3B | Writing | **0.873** | 30 GB | `mlx-community/Qwen3-Next-80B-A3B-4bit` |
| 8081 | Qwen3-VL-32B-Thinking | Writing+Vision | **0.862** | 18 GB | `mlx-community/Qwen3-VL-32B-Thinking-4bit` |
| 8082 | Qwen3-VL-8B-Thinking | Writing (small) | **0.855** | 5 GB | `mlx-community/Qwen3-VL-8B-Thinking-4bit` |
| 8086 | Llama-3.3-70B | Reasoning | 72.0% SWE-bench | 40 GB | `mlx-community/Llama-3.3-70B-Instruct-4bit` |

**Why these models?** WritingBench evaluates text quality across 6 domains and 100 subdomains with 1,239 queries. The top 3 models are the best open-source writers available. Llama-3.3-70B is included for its strong reasoning capability when minutes require complex analysis.

**Fallback behavior:** If the selected model is unavailable, nChar automatically tries the next available model in decreasing WritingBench score order.

### MLX-Whisper STT

For fully local real-time speech-to-text, nChar uses [mlx-whisper-dictation](https://github.com/temn/mlx-whisper-dictation)'s WebSocket server, which speaks the Deepgram protocol over `ws://127.0.0.1:8888/v1/listen`.

**nChar auto-launches the server** when you select "MLX Whisper" as the STT provider. If the venv is not found, nChar shows setup instructions.

To start the server manually:

```bash
screen -dmS whisper-server ~/projects/external/mlx-whisper-dictation/venv-lite/bin/python \
  ~/projects/external/mlx-whisper-dictation/mlx-whisper-server.py
```

Then select "MLX Whisper" in Settings > AI > Transcription. Transcription happens in real-time as you speak.

The model (~3 GB) loads on first connection and stays in memory. Stop with `screen -X -S whisper-server quit`.

### Cloud AI subscriptions (optional)

Many people already have a subscription to one of the major AI providers. nChar supports piping transcripts to their CLI applications via tmux:

- **Claude** (Anthropic) — `claude` CLI
- **Codex** (OpenAI) — `codex` CLI
- **Gemini** (Google) — `gemini` CLI

This avoids API key management — you authenticate once via the CLI tool and nChar pipes the transcript for processing. Use the "Export to CLI" action in the session view.

You can also configure these providers directly in Settings > AI > LLM with your API key, which uses their API endpoints instead of the CLI.

### Installation of local MLX models

```bash
# Install mlx-lm (Apple Silicon only)
uv tool install mlx-lm
# or: pip install mlx-lm

# Download and test a model (smallest, 5 GB RAM)
mlx_lm.generate --model mlx-community/Qwen3-VL-8B-Thinking-4bit \
                 --max-tokens 1 --prompt "test"

# Start a server (OpenAI-compatible API)
mlx_lm.server --model mlx-community/Qwen3-VL-8B-Thinking-4bit --port 8082

# For the best writing quality (30 GB RAM)
mlx_lm.server --model mlx-community/Qwen3-Next-80B-A3B-4bit --port 8080

# Run multiple models simultaneously
mlx_lm.server --model mlx-community/Qwen3-Next-80B-A3B-4bit --port 8080 &
mlx_lm.server --model mlx-community/Qwen3-VL-8B-Thinking-4bit --port 8082 &
```

Models are downloaded to `~/.cache/huggingface/hub/` on first use. You can also use LM Studio (`brew install --cask lm-studio`) which provides a GUI for model management and uses the same MLX engine.

### Installation of MLX-Whisper STT

```bash
# Clone and set up the mlx-whisper-dictation server:
git clone https://github.com/temn/mlx-whisper-dictation ~/projects/external/mlx-whisper-dictation
cd ~/projects/external/mlx-whisper-dictation
python3.13 -m venv venv-lite
venv-lite/bin/pip install mlx-whisper websockets

# The whisper model (~3 GB) downloads automatically on first use.
# nChar will auto-launch this server when you select MLX Whisper as STT provider.
```

In nChar: Settings > AI > Transcription > select "MLX Whisper".

The server accepts WebSocket connections on `ws://127.0.0.1:8888/v1/listen`, buffers 3-second audio chunks, and returns transcript segments in real-time. It uses ~3 GB RAM while running. Stop it with `Ctrl+C` when done.

### Installation of cloud AI

If you prefer cloud AI providers, install their CLI tools:

- **Claude CLI:** [docs.anthropic.com/claude-code](https://docs.anthropic.com/en/docs/claude-code)
- **Codex CLI:** [github.com/openai/codex](https://github.com/openai/codex)
- **Gemini CLI:** [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)

Each tool handles its own authentication. Once installed and authenticated, use nChar's "Export to CLI" feature to pipe transcripts.

## Privacy hardening details

nChar achieves complete privacy through build-time configuration — no API keys for telemetry services are provided, so those code paths are never activated:

| Environment variable | Purpose | nChar value |
|---------------------|---------|-------------|
| `POSTHOG_API_KEY` | PostHog analytics | Not set |
| `VITE_POSTHOG_API_KEY` | PostHog (frontend) | Not set |
| `SENTRY_DSN` | Sentry error reporting (Rust) | Not set |
| `VITE_SENTRY_DSN` | Sentry error reporting (frontend) | Not set |
| `VITE_SUPABASE_URL` | Supabase auth/cloud | Not set |
| `VITE_SUPABASE_ANON_KEY` | Supabase auth/cloud | Not set |
| `HONEYCOMB_API_KEY` | Honeycomb tracing | Not set |

The auto-updater plugin (`tauri_plugin_updater2`) contacts `desktop2.hyprnote.com` every 30 minutes to check for updates. This is disabled in nChar by not including the updater endpoint configuration.

**What still works without external services:**
- Recording and transcription (with local STT)
- AI-powered minutes and summaries (with local LLM)
- Note editing, templates, calendar integration (Apple Calendar is local)
- All data stored in local SQLite database

## Branch strategy

| Branch | Purpose |
|--------|---------|
| `main` | Pure mirror of upstream `fastrepl/char:main`. Never commit here. |
| `nchar-main` | All nChar customizations. PRs target this branch. |

Syncing upstream:
```bash
git fetch upstream
git checkout main
git merge upstream/main
git checkout nchar-main
git merge main
```

## Philosophy

- **Complete privacy** — No usage data leaves your machine unless you explicitly choose a cloud AI provider.
- **Minimal upstream divergence** — New functionality lives in new files or as plugin-scoped additions. Upstream files are modified only when necessary (appending to provider arrays, adding switch cases).
- **Plugin-first** — If it can be a separate plugin or module, it should be.
- **Local-first AI** — Prefer on-device models over cloud APIs. Cloud is available but not required.

## Contributing

PRs are welcome against the `nchar-main` branch. When contributing:

1. Keep changes scoped to new files whenever possible
2. Follow the existing code style (run `pnpm exec dprint fmt` after changes)
3. If modifying an upstream file, add your changes at the end of arrays or as new switch cases to minimize merge conflicts
4. Run `pnpm -F desktop typecheck` for TypeScript and `cargo check` for Rust changes

## License

GPL-3.0, same as upstream. All modifications in this fork are also licensed under GPL-3.0. See [LICENSE](./LICENSE).
