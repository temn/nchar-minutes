import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Command } from "@tauri-apps/plugin-shell";

const MLX_WHISPER_PORT = 8888;
const MLX_WHISPER_URL = `http://127.0.0.1:${MLX_WHISPER_PORT}`;
const SCREEN_SESSION = "whisper-server";
const VENV_PYTHON =
  "~/projects/external/mlx-whisper-dictation/venv-lite/bin/python";
const SERVER_SCRIPT =
  "~/projects/external/mlx-whisper-dictation/mlx-whisper-server.py";

export type MlxWhisperStatus =
  | { status: "running" }
  | { status: "starting" }
  | { status: "unavailable"; message: string };

function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    const home = typeof process !== "undefined" ? process.env.HOME : undefined;
    if (home) {
      return path.replace("~", home);
    }
  }
  return path;
}

export async function checkMlxWhisperServer(): Promise<MlxWhisperStatus> {
  try {
    const response = await tauriFetch(MLX_WHISPER_URL, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok || response.status === 404 || response.status === 426) {
      return { status: "running" };
    }
  } catch {
    // not responding
  }

  return { status: "unavailable", message: "MLX Whisper server not running." };
}

export async function tryLaunchMlxWhisperServer(): Promise<MlxWhisperStatus> {
  const alreadyRunning = await checkMlxWhisperServer();
  if (alreadyRunning.status === "running") {
    return alreadyRunning;
  }

  const pythonPath = expandHome(VENV_PYTHON);
  const scriptPath = expandHome(SERVER_SCRIPT);

  try {
    const checkPython = await Command.create("test", [
      "-x",
      pythonPath,
    ]).execute();
    if (checkPython.code !== 0) {
      return {
        status: "unavailable",
        message:
          `MLX Whisper venv not found at ${VENV_PYTHON}.\n\n` +
          "Setup: run 'make dictation-tools' in your nordlinglab-agentic-ai-cli-vscode-container-setup repo, " +
          "or install manually:\n\n" +
          "  python3.13 -m venv ~/projects/external/mlx-whisper-dictation/venv-lite\n" +
          "  ~/projects/external/mlx-whisper-dictation/venv-lite/bin/pip install mlx-whisper websockets\n",
      };
    }

    const checkScript = await Command.create("test", [
      "-f",
      scriptPath,
    ]).execute();
    if (checkScript.code !== 0) {
      return {
        status: "unavailable",
        message:
          `Server script not found at ${SERVER_SCRIPT}.\n\n` +
          "Clone the mlx-whisper-dictation repo:\n" +
          "  git clone https://github.com/temn/mlx-whisper-dictation ~/projects/external/mlx-whisper-dictation\n",
      };
    }

    await Command.create("screen", [
      "-dmS",
      SCREEN_SESSION,
      pythonPath,
      scriptPath,
    ]).execute();

    // Wait for server to start (up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const check = await checkMlxWhisperServer();
      if (check.status === "running") {
        return { status: "running" };
      }
    }

    return {
      status: "unavailable",
      message:
        "MLX Whisper server launched but not responding after 10s.\n\n" +
        "Check the screen session:\n" +
        `  screen -r ${SCREEN_SESSION}\n\n` +
        "Or start manually:\n" +
        `  ${VENV_PYTHON} ${SERVER_SCRIPT}\n`,
    };
  } catch (err) {
    return {
      status: "unavailable",
      message:
        `Failed to launch MLX Whisper server: ${err}\n\n` +
        "Start manually:\n" +
        `  screen -dmS ${SCREEN_SESSION} ${VENV_PYTHON} ${SERVER_SCRIPT}\n`,
    };
  }
}
