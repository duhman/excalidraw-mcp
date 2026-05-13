import { describe, expect, it, vi } from "vitest";
import {
  ExcalidrawPlusApiClient,
  createExcalidrawPlusApiClientFromEnv,
  type ExcalidrawPlusFetch,
  type ExcalidrawPlusSceneContent,
} from "../../src/official/excalidrawPlusApiClient.js";
import { AppError } from "../../src/utils/errors.js";

const API_KEY = "test-api-key-redacted";

const sceneContent: ExcalidrawPlusSceneContent = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  appState: { viewBackgroundColor: "#ffffff" },
  elements: [{ id: "box", type: "rectangle", version: 1 }],
  sceneVersion: "123",
  files: {},
};

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function createFetch(response: Response = jsonResponse(sceneContent)) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof URL ? input : new URL(input), init: init ?? {} });
    return response;
  }) satisfies ExcalidrawPlusFetch;

  return { fetchImpl, calls };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe("ExcalidrawPlusApiClient", () => {
  it("reports unconfigured status without exposing secrets", () => {
    const client = new ExcalidrawPlusApiClient({ apiKey: "   " });

    expect(client.isConfigured()).toBe(false);
    expect(client.status()).toEqual({
      configured: false,
      baseUrl: "https://api.excalidraw.com/api/v1",
      reason: "missing_api_key",
    });
  });

  it("injects bearer auth header and supports base URL override", async () => {
    const { fetchImpl, calls } = createFetch(jsonResponse({ limit: 10, offset: 0, hasNextPage: false, data: [] }));
    const client = new ExcalidrawPlusApiClient({
      apiKey: API_KEY,
      baseUrl: "https://example.test/custom/",
      fetch: fetchImpl,
    });

    await client.listScenes();

    expect(calls[0].url.toString()).toBe("https://example.test/custom/scenes");
    expect(headersOf(calls[0].init).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headersOf(calls[0].init).Accept).toBe("application/json");
  });

  it("sends list scene query parameters", async () => {
    const { calls, fetchImpl } = createFetch(jsonResponse({ limit: 25, offset: 50, hasNextPage: false, data: [] }));
    const client = new ExcalidrawPlusApiClient({ apiKey: API_KEY, fetch: fetchImpl });

    await client.listScenes({ limit: 25, offset: 50, collectionId: "team collection" });

    expect(calls[0].url.pathname).toBe("/api/v1/scenes");
    expect(calls[0].url.searchParams.get("limit")).toBe("25");
    expect(calls[0].url.searchParams.get("offset")).toBe("50");
    expect(calls[0].url.searchParams.get("collectionId")).toBe("team collection");
  });

  it("sends create scene body", async () => {
    const { calls, fetchImpl } = createFetch(jsonResponse({ metadata: { id: "scene-1", name: "Roadmap" } }));
    const client = new ExcalidrawPlusApiClient({ apiKey: API_KEY, fetch: fetchImpl });

    await client.createScene({
      name: "Roadmap",
      pinned: true,
      collectionId: "collection-1",
    });

    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/api/v1/scenes");
    expect(headersOf(calls[0].init)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      name: "Roadmap",
      pinned: true,
      collectionId: "collection-1",
    });
  });

  it("gets scene content", async () => {
    const { calls, fetchImpl } = createFetch();
    const client = new ExcalidrawPlusApiClient({ apiKey: API_KEY, fetch: fetchImpl });

    const result = await client.getSceneContent("scene/with spaces");

    expect(result).toEqual(sceneContent);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url.pathname).toBe("/api/v1/scenes/scene%2Fwith%20spaces/content");
  });

  it("sends replace scene content body", async () => {
    const { calls, fetchImpl } = createFetch();
    const client = new ExcalidrawPlusApiClient({ apiKey: API_KEY, fetch: fetchImpl });

    await client.replaceSceneContent("scene-1", {
      type: "excalidraw",
      version: 2,
      source: "agent",
      appState: { viewBackgroundColor: "#fff" },
      elements: [{ id: "box", type: "rectangle", version: 2 }],
      files: { file1: { id: "file1", mimeType: "image/png" } },
    });

    expect(calls[0].init.method).toBe("PUT");
    expect(calls[0].url.pathname).toBe("/api/v1/scenes/scene-1/content");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      type: "excalidraw",
      version: 2,
      source: "agent",
      appState: { viewBackgroundColor: "#fff" },
      elements: [{ id: "box", type: "rectangle", version: 2 }],
      files: { file1: { id: "file1", mimeType: "image/png" } },
    });
  });

  it("sends patch scene content body", async () => {
    const { calls, fetchImpl } = createFetch();
    const client = new ExcalidrawPlusApiClient({ apiKey: API_KEY, fetch: fetchImpl });

    await client.patchSceneContent("scene-1", {
      appState: { theme: "dark" },
      elements: [{ id: "box", version: 3 }],
    });

    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].url.pathname).toBe("/api/v1/scenes/scene-1/content");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      appState: { theme: "dark" },
      elements: [{ id: "box", version: 3 }],
    });
  });

  it("rejects empty content patches before fetch", async () => {
    const { fetchImpl } = createFetch();
    const client = new ExcalidrawPlusApiClient({ apiKey: API_KEY, fetch: fetchImpl });

    await expect(client.patchSceneContent("scene-1", {})).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps HTTP errors to redacted AppError details", async () => {
    const response = jsonResponse(
      {
        error: `Authorization failed for raw key ${API_KEY} and Bearer ${API_KEY}`,
      },
      { status: 401, statusText: `No raw ${API_KEY}` },
    );
    const { fetchImpl } = createFetch(response);
    const client = new ExcalidrawPlusApiClient({ apiKey: API_KEY, fetch: fetchImpl });

    try {
      await client.listScenes();
      throw new Error("Expected listScenes to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("LOCKED");
      expect(appError.status).toBe(401);
      expect(appError.message).toBe("Excalidraw+ API authentication failed");
      expect(JSON.stringify(appError.details)).not.toContain(API_KEY);
      expect(JSON.stringify(appError.details)).toContain("Bearer [REDACTED]");
    }
  });

  it("maps network failures to redacted degraded AppError", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`socket closed while using Bearer ${API_KEY}`);
    }) satisfies ExcalidrawPlusFetch;
    const client = new ExcalidrawPlusApiClient({ apiKey: API_KEY, fetch: fetchImpl });

    await expect(client.getSceneContent("scene-1")).rejects.toMatchObject({
      code: "DEGRADED_MODE",
      status: 503,
      details: {
        cause: "socket closed while using Bearer [REDACTED]",
      },
    });
  });

  it("builds configured clients from environment without returning the API key", () => {
    const client = createExcalidrawPlusApiClientFromEnv({
      EXCALIDRAW_PLUS_API_KEY: API_KEY,
      EXCALIDRAW_PLUS_API_BASE_URL: "https://api.example.test/api/v1",
    });

    expect(client.isConfigured()).toBe(true);
    expect(client.status()).toEqual({
      configured: true,
      baseUrl: "https://api.example.test/api/v1",
    });
    expect(JSON.stringify(client.status())).not.toContain(API_KEY);
  });
});
