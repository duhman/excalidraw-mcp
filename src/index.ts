import { cwd } from "node:process";
import { readFile } from "node:fs/promises";
import { createExcalidrawMcpServer } from "./server/createServer.js";
import { startStdioTransport } from "./transports/stdio.js";
import { startHttpTransport } from "./transports/http.js";

function parseArg(flag: string): string | undefined {
  const index = process.argv.findIndex((value) => value === flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

async function resolvePackageVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

async function main(): Promise<void> {
  const transport = parseArg("--transport") ?? process.env.MCP_TRANSPORT ?? "stdio";
  const workspaceRoot = process.env.MCP_WORKSPACE_ROOT ?? cwd();
  const version = await resolvePackageVersion();

  if (transport === "http") {
    const host = parseArg("--host") ?? process.env.MCP_HTTP_HOST ?? "127.0.0.1";
    const port = Number(parseArg("--port") ?? process.env.MCP_HTTP_PORT ?? "8788");
    const path = parseArg("--path") ?? process.env.MCP_HTTP_PATH ?? "/mcp";

    await startHttpTransport({
      host,
      port,
      path,
      workspaceRoot
    });

    process.stderr.write(`excalidraw-mcp http listening on http://${host}:${port}${path}\n`);
    return;
  }

  const services = await createExcalidrawMcpServer({
    workspaceRoot,
    version
  });

  await startStdioTransport(services.server);

  const shutdown = async () => {
    await services.browserEngine.close();
    await services.server.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  process.stderr.write(`Failed to start excalidraw-mcp: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
