/**
 * Alternative brain: the operator's own Claude Code (`claude -p`) answers /x402 prompts, using this
 * agent's MCP face as its only tools. No API key and no Pieverse credit: it runs on the operator's
 * Claude subscription, so it is a local-development brain (`PORTIR_BRAIN=claude-cli`), not a hosted one.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PORTIR_TOOLS } from "./tools.js";

const TIMEOUT_MS = Number(process.env.PORTIR_BRAIN_TIMEOUT_MS ?? 180_000);

let mcpConfig: string | undefined;
function mcpConfigFile(): string {
  if (!mcpConfig) {
    const port = process.env.AGENT_PORT ?? "9000";
    mcpConfig = join(mkdtempSync(join(tmpdir(), "portir-brain-")), "mcp.json");
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { portir: { type: "http", url: `http://127.0.0.1:${port}/mcp` } } }));
  }
  return mcpConfig;
}

export function claudeCliWork(prompt: string, system: string, signal?: AbortSignal): Promise<string> {
  const allowed = PORTIR_TOOLS.map((t) => `mcp__portir__${t.name}`);
  const args = [
    "-p",
    "--output-format", "text",
    "--strict-mcp-config",
    "--mcp-config", mcpConfigFile(),
    "--allowedTools", ...allowed,
    "--tools", "", // no built-in tools: the market lives behind MCP, nothing on this machine is relevant
    "--system-prompt", system,
    "--model", process.env.PORTIR_BRAIN_MODEL ?? "sonnet",
  ];
  return new Promise((resolve, reject) => {
    const child = execFile("claude", args, { timeout: TIMEOUT_MS, maxBuffer: 1 << 20, signal, env: { ...process.env, CLAUDECODE: "" } }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`claude -p failed: ${err.message}${stderr ? ` — ${stderr.slice(0, 300)}` : ""}`));
      resolve(stdout.trim());
    });
    child.stdin?.end(prompt);
  });
}
