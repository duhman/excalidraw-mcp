import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const destination = process.argv[2] === "excalidraw" ? "excalidraw" : "plus";
const workspaceRoot = await mkdtemp(join(tmpdir(), `excalidraw-mcp-account-${destination}-`));
const serverEntry = resolve("dist/src/index.js");
const session = `live-smoke-${destination}`;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry, "--transport", "stdio"],
  cwd: resolve("."),
  env: {
    ...process.env,
    MCP_WORKSPACE_ROOT: workspaceRoot,
  },
  stderr: "inherit",
});

const client = new Client({
  name: "account-live-smoke-client",
  version: "1.0.0",
});

function unwrap(result, label) {
  if (result?.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(result.structuredContent ?? result)}`);
  }
  return result?.structuredContent?.data ?? {};
}

try {
  await client.connect(transport);

  unwrap(
    await client.callTool({
      name: "scene_create",
      arguments: {
        sceneId: "account-live-smoke",
        name: `Account Live Smoke (${destination})`,
      },
    }),
    "scene_create",
  );

  unwrap(
    await client.callTool({
      name: "nodes_compose",
      arguments: {
        sceneId: "account-live-smoke",
        preset: "process",
        nodes: [
          {
            nodeId: "live-node",
            title: "Account Smoke",
            body: `Destination: ${destination}`,
            x: 80,
            y: 120,
            width: 240,
            minHeight: 120,
          },
        ],
      },
    }),
    "nodes_compose",
  );

  const login = unwrap(
    await client.callTool({
      name: "account_login_session",
      arguments: {
        destination,
        mode: "headed",
        session,
        closeOnComplete: true,
      },
    }),
    "account_login_session",
  ).login;

  if (login.status !== "ready") {
    throw new Error(
      `Login checkpoint required for ${destination}. Complete sign-in in the opened profile and rerun this smoke.`,
    );
  }

  const importResult = unwrap(
    await client.callTool({
      name: "account_import_scene",
      arguments: {
        sceneId: "account-live-smoke",
        destination,
        mode: "headed",
        session,
        allowInteractiveLogin: false,
        closeOnComplete: true,
      },
    }),
    "account_import_scene",
  ).import;

  if (importResult.status !== "success") {
    throw new Error(`Live account import did not succeed: ${JSON.stringify(importResult)}`);
  }

  const status = unwrap(
    await client.callTool({
      name: "account_link_status",
      arguments: {
        session,
      },
    }),
    "account_link_status",
  );

  process.stdout.write(
    `account live smoke passed for ${destination} (imports=${status.importsCount})\n`,
  );
} finally {
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
}
