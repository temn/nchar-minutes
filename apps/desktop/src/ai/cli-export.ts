import { Command } from "@tauri-apps/plugin-shell";

export type CliTool = "claude" | "codex" | "gemini";

const CLI_COMMANDS: Record<CliTool, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

async function isCommandAvailable(cmd: string): Promise<boolean> {
  try {
    const result = await Command.create("which", [cmd]).execute();
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function checkCliToolAvailability(): Promise<
  Record<CliTool, boolean>
> {
  const tools = Object.keys(CLI_COMMANDS) as CliTool[];
  const results = await Promise.all(
    tools.map(async (tool) => ({
      tool,
      available: await isCommandAvailable(CLI_COMMANDS[tool]),
    })),
  );
  return Object.fromEntries(
    results.map((r) => [r.tool, r.available]),
  ) as Record<CliTool, boolean>;
}

export async function exportToCliTool(
  transcript: string,
  tool: CliTool,
  prompt?: string,
): Promise<{ sessionName: string } | { error: string }> {
  const tmuxAvailable = await isCommandAvailable("tmux");
  if (!tmuxAvailable) {
    return {
      error: "tmux is not installed. Install it with: brew install tmux",
    };
  }

  const cliCmd = CLI_COMMANDS[tool];
  const toolAvailable = await isCommandAvailable(cliCmd);
  if (!toolAvailable) {
    return { error: `${cliCmd} CLI is not installed or not in PATH.` };
  }

  const sessionName = `nchar-${tool}`;

  const input = prompt
    ? `${prompt}\n\n--- Transcript ---\n\n${transcript}`
    : `Please analyze this meeting transcript and provide a detailed summary with action items:\n\n${transcript}`;

  const escapedInput = input.replace(/'/g, "'\\''");

  try {
    await Command.create("tmux", ["kill-session", "-t", sessionName]).execute();
  } catch {
    // session doesn't exist, that's fine
  }

  try {
    await Command.create("tmux", [
      "new-session",
      "-d",
      "-s",
      sessionName,
      "bash",
      "-c",
      `echo '${escapedInput}' | ${cliCmd}; read -p 'Press Enter to close...'`,
    ]).execute();

    return { sessionName };
  } catch (err) {
    return { error: `Failed to create tmux session: ${err}` };
  }
}
