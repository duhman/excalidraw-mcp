import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createExcalidrawMcpServer } from "../server/createServer.js";

interface SessionEntry {
  server: Awaited<ReturnType<typeof createExcalidrawMcpServer>>;
  transport: StreamableHTTPServerTransport;
}

export interface HttpTransportOptions {
  host: string;
  port: number;
  path: string;
  workspaceRoot: string;
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function parseHostHeader(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const lower = value.toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    return end > -1 ? lower.slice(0, end + 1) : lower;
  }

  return lower.split(":")[0];
}

function parseOriginHost(origin: string | undefined): string {
  if (!origin) {
    return "";
  }

  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase();
  } catch {
    return "";
  }
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return undefined;
  }

  return JSON.parse(text);
}

async function closeSession(entry: SessionEntry): Promise<void> {
  await entry.server.browserEngine.close();
  await entry.server.server.close();
}

export async function startHttpTransport(options: HttpTransportOptions): Promise<Server> {
  const sessions = new Map<string, SessionEntry>();
  const allowedHosts = new Set(
    (options.allowedHosts ?? ["localhost", "127.0.0.1", "::1", "[::1]"]).map((host) => host.toLowerCase())
  );
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map((origin) => origin.toLowerCase()));

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "", `http://${req.headers.host ?? `${options.host}:${options.port}`}`);

      if (requestUrl.pathname !== options.path) {
        sendJson(res, 404, { error: "Not Found" });
        return;
      }

      const host = parseHostHeader(req.headers.host);
      if (allowedHosts.size > 0 && host && !allowedHosts.has(host)) {
        sendJson(res, 403, { error: "Host not allowed" });
        return;
      }

      const originHost = parseOriginHost(req.headers.origin);
      if (originHost && allowedOrigins.size > 0 && !allowedOrigins.has(originHost)) {
        sendJson(res, 403, { error: "Origin not allowed" });
        return;
      }

      res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type, mcp-session-id");
      res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

      if (req.method === "POST") {
        const parsedBody = await parseJsonBody(req);

        let entry: SessionEntry | undefined;
        if (!sessionId) {
          if (!isInitializeRequest(parsedBody)) {
            sendJson(res, 400, {
              error: "Missing Mcp-Session-Id. New sessions can only be created via initialize request."
            });
            return;
          }

          const createdServer = await createExcalidrawMcpServer({
            workspaceRoot: options.workspaceRoot
          });

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: async (generatedSessionId) => {
              sessions.set(generatedSessionId, {
                server: createdServer,
                transport
              });
            },
            onsessionclosed: async (generatedSessionId) => {
              const existing = sessions.get(generatedSessionId);
              if (existing) {
                sessions.delete(generatedSessionId);
                await closeSession(existing);
              }
            }
          });

          await createdServer.server.connect(transport);
          entry = {
            server: createdServer,
            transport
          };
        } else {
          entry = sessions.get(sessionId);
          if (!entry) {
            sendJson(res, 404, { error: "Unknown session" });
            return;
          }
        }

        await entry.transport.handleRequest(req, res, parsedBody);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        if (!sessionId) {
          sendJson(res, 400, { error: "Missing Mcp-Session-Id header" });
          return;
        }

        const entry = sessions.get(sessionId);
        if (!entry) {
          sendJson(res, 404, { error: "Unknown session" });
          return;
        }

        await entry.transport.handleRequest(req, res);

        if (req.method === "DELETE") {
          sessions.delete(sessionId);
          await closeSession(entry);
        }

        return;
      }

      sendJson(res, 405, {
        error: `Method ${req.method ?? "UNKNOWN"} not allowed`
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Internal server error"
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const closeOriginal = server.close.bind(server);
  server.close = ((callback?: (err?: Error) => void) => {
    void (async () => {
      for (const entry of sessions.values()) {
        await closeSession(entry);
      }
      sessions.clear();
    })();

    return closeOriginal(callback);
  }) as typeof server.close;

  return server;
}
