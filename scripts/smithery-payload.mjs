// Prints the Smithery stdio release payload for the built server.
// The tool list comes from the running server itself, so the schemas Smithery shows are the ones
// the code registers. They cannot live in mcpb/manifest.json: the mcpb validator rejects
// `inputSchema` there, while Smithery's release API requires it.
// Usage: node scripts/smithery-payload.mjs <dist/index.js> <version>
import { spawn } from "node:child_process";

const TIMEOUT_MS = 15000;
const [entry, version] = process.argv.slice(2);
if (!entry || !version) {
  console.error("usage: node scripts/smithery-payload.mjs <dist/index.js> <version>");
  process.exit(2);
}

const server = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "inherit"] });
const timer = setTimeout(() => {
  console.error(`no tools/list answer from ${entry} within ${TIMEOUT_MS} ms`);
  server.kill();
  process.exit(1);
}, TIMEOUT_MS);

let pending = "";
server.stdout.on("data", (chunk) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    const message = JSON.parse(line);
    if (message.id !== 2) continue;
    const payload = {
      type: "stdio",
      runtime: "node",
      serverCard: { serverInfo: { name: "roundcut-mcp", version }, tools: message.result.tools },
    };
    process.stdout.write(JSON.stringify(payload));
    clearTimeout(timer);
    server.kill();
  }
});

const send = (message) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smithery-payload", version: "1" } } });
send({ method: "notifications/initialized" });
send({ id: 2, method: "tools/list" });
