import { AppError } from "../utils/errors.js";

export const EXCALIDRAW_PLUS_API_BASE_URL = "https://api.excalidraw.com/api/v1";
export const EXCALIDRAW_PLUS_API_KEY_ENV = "EXCALIDRAW_PLUS_API_KEY";
export const EXCALIDRAW_PLUS_API_BASE_URL_ENV = "EXCALIDRAW_PLUS_API_BASE_URL";

export type ExcalidrawPlusFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ExcalidrawPlusApiClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: ExcalidrawPlusFetch;
}

export interface ExcalidrawPlusStatus {
  configured: boolean;
  baseUrl: string;
  reason?: "missing_api_key";
}

export interface ExcalidrawPlusListScenesRequest {
  limit?: number;
  offset?: number;
  collectionId?: string;
}

export interface ExcalidrawPlusSceneMetadata {
  id?: string;
  sceneId?: string;
  name?: string;
  pinned?: boolean;
  collectionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ExcalidrawPlusSceneListItem {
  metadata: ExcalidrawPlusSceneMetadata;
  readOnlyLinks?: unknown[];
  sharedSlidesLinks?: unknown[];
  [key: string]: unknown;
}

export interface ExcalidrawPlusListScenesResponse {
  limit: number;
  offset: number;
  hasNextPage: boolean;
  data: ExcalidrawPlusSceneListItem[];
}

export interface ExcalidrawPlusCreateSceneRequest {
  name: string;
  pinned?: boolean;
  collectionId?: string;
}

export type ExcalidrawPlusCreateSceneResponse = ExcalidrawPlusSceneListItem | Record<string, unknown>;

export interface ExcalidrawPlusSceneContent {
  type: string;
  version: number;
  source: string;
  appState: Record<string, unknown>;
  elements: Array<Record<string, unknown>>;
  sceneVersion: string;
  files: Record<string, unknown>;
  filesFailedToEmbed?: unknown;
  [key: string]: unknown;
}

export type ExcalidrawPlusReplaceSceneContentRequest = Omit<
  ExcalidrawPlusSceneContent,
  "sceneVersion" | "filesFailedToEmbed"
> & {
  sceneVersion?: number;
  filesFailedToEmbed?: unknown;
};

export interface ExcalidrawPlusPatchSceneContentRequest {
  elements?: Array<Record<string, unknown>>;
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  filesFailedToEmbed?: unknown;
}

export interface ExcalidrawPlusSceneProvider {
  isConfigured(): boolean;
  status(): ExcalidrawPlusStatus;
  listScenes(request?: ExcalidrawPlusListScenesRequest): Promise<ExcalidrawPlusListScenesResponse>;
  createScene(request: ExcalidrawPlusCreateSceneRequest): Promise<ExcalidrawPlusCreateSceneResponse>;
  getSceneContent(sceneId: string): Promise<ExcalidrawPlusSceneContent>;
  replaceSceneContent(
    sceneId: string,
    content: ExcalidrawPlusReplaceSceneContentRequest,
  ): Promise<ExcalidrawPlusSceneContent>;
  patchSceneContent(
    sceneId: string,
    patch: ExcalidrawPlusPatchSceneContentRequest,
  ): Promise<ExcalidrawPlusSceneContent>;
}

export class ExcalidrawPlusApiClient implements ExcalidrawPlusSceneProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: ExcalidrawPlusFetch;

  constructor(options: ExcalidrawPlusApiClientOptions = {}) {
    const apiKey = options.apiKey?.trim();
    this.apiKey = apiKey && apiKey.length > 0 ? apiKey : undefined;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? EXCALIDRAW_PLUS_API_BASE_URL);
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  status(): ExcalidrawPlusStatus {
    if (!this.isConfigured()) {
      return {
        configured: false,
        baseUrl: this.baseUrl,
        reason: "missing_api_key",
      };
    }

    return {
      configured: true,
      baseUrl: this.baseUrl,
    };
  }

  async listScenes(request: ExcalidrawPlusListScenesRequest = {}): Promise<ExcalidrawPlusListScenesResponse> {
    const query = new URLSearchParams();
    if (request.limit !== undefined) {
      query.set("limit", String(request.limit));
    }
    if (request.offset !== undefined) {
      query.set("offset", String(request.offset));
    }
    if (request.collectionId !== undefined) {
      query.set("collectionId", request.collectionId);
    }

    const path = query.size > 0 ? `/scenes?${query.toString()}` : "/scenes";
    return this.request<ExcalidrawPlusListScenesResponse>("GET", path);
  }

  async createScene(request: ExcalidrawPlusCreateSceneRequest): Promise<ExcalidrawPlusCreateSceneResponse> {
    return this.request<ExcalidrawPlusCreateSceneResponse>("POST", "/scenes", request);
  }

  async getSceneContent(sceneId: string): Promise<ExcalidrawPlusSceneContent> {
    return this.request<ExcalidrawPlusSceneContent>("GET", sceneContentPath(sceneId));
  }

  async replaceSceneContent(
    sceneId: string,
    content: ExcalidrawPlusReplaceSceneContentRequest,
  ): Promise<ExcalidrawPlusSceneContent> {
    return this.request<ExcalidrawPlusSceneContent>("PUT", sceneContentPath(sceneId), content);
  }

  async patchSceneContent(
    sceneId: string,
    patch: ExcalidrawPlusPatchSceneContentRequest,
  ): Promise<ExcalidrawPlusSceneContent> {
    if (patch.elements === undefined && patch.appState === undefined && patch.files === undefined) {
      throw new AppError(
        "BAD_REQUEST",
        "Excalidraw+ content patch must include elements, appState, or files",
        400,
        { endpoint: sceneContentPath(sceneId), method: "PATCH" },
      );
    }

    return this.request<ExcalidrawPlusSceneContent>("PATCH", sceneContentPath(sceneId), patch);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.apiKey) {
      throw new AppError("LOCKED", "Excalidraw+ API key is not configured", 401, {
        endpoint: path,
        method,
      });
    }

    const init: RequestInit = {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = {
        ...init.headers,
        "Content-Type": "application/json",
      };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(new URL(`${this.baseUrl}${path}`), init);
    } catch (error) {
      throw new AppError("DEGRADED_MODE", "Excalidraw+ API request failed", 503, {
        endpoint: path,
        method,
        cause: redactSecretText(error instanceof Error ? error.message : String(error), this.apiKey),
      });
    }

    if (!response.ok) {
      throw await this.toHttpAppError(method, path, response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async toHttpAppError(method: string, path: string, response: Response): Promise<AppError> {
    const responseText = await readResponseText(response);
    const details: Record<string, unknown> = {
      endpoint: path,
      method,
      status: response.status,
      statusText: redactSecretText(response.statusText, this.apiKey),
    };

    if (responseText) {
      details.responseBody = redactSecretText(responseText, this.apiKey).slice(0, 1000);
    }

    switch (response.status) {
      case 400:
        return new AppError("BAD_REQUEST", "Excalidraw+ API rejected the request", 400, details);
      case 401:
        return new AppError("LOCKED", "Excalidraw+ API authentication failed", 401, details);
      case 403:
        return new AppError("LOCKED", "Excalidraw+ API permission denied", 403, details);
      case 404:
        return new AppError("NOT_FOUND", "Excalidraw+ API resource not found", 404, details);
      default:
        return new AppError("DEGRADED_MODE", "Excalidraw+ API returned an unexpected error", response.status, details);
    }
  }
}

export class ExcalidrawPlusStorageProvider implements ExcalidrawPlusSceneProvider {
  public readonly providerId = "excalidraw-plus";

  constructor(private readonly client: ExcalidrawPlusApiClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  status(): ExcalidrawPlusStatus {
    return this.client.status();
  }

  listScenes(request?: ExcalidrawPlusListScenesRequest): Promise<ExcalidrawPlusListScenesResponse> {
    return this.client.listScenes(request);
  }

  createScene(request: ExcalidrawPlusCreateSceneRequest): Promise<ExcalidrawPlusCreateSceneResponse> {
    return this.client.createScene(request);
  }

  getSceneContent(sceneId: string): Promise<ExcalidrawPlusSceneContent> {
    return this.client.getSceneContent(sceneId);
  }

  replaceSceneContent(
    sceneId: string,
    content: ExcalidrawPlusReplaceSceneContentRequest,
  ): Promise<ExcalidrawPlusSceneContent> {
    return this.client.replaceSceneContent(sceneId, content);
  }

  patchSceneContent(
    sceneId: string,
    patch: ExcalidrawPlusPatchSceneContentRequest,
  ): Promise<ExcalidrawPlusSceneContent> {
    return this.client.patchSceneContent(sceneId, patch);
  }
}

export function createExcalidrawPlusApiClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: ExcalidrawPlusFetch,
): ExcalidrawPlusApiClient {
  return new ExcalidrawPlusApiClient({
    apiKey: env[EXCALIDRAW_PLUS_API_KEY_ENV],
    baseUrl: env[EXCALIDRAW_PLUS_API_BASE_URL_ENV],
    fetch: fetchImpl,
  });
}

export function createExcalidrawPlusStorageProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: ExcalidrawPlusFetch,
): ExcalidrawPlusStorageProvider {
  return new ExcalidrawPlusStorageProvider(createExcalidrawPlusApiClientFromEnv(env, fetchImpl));
}

function sceneContentPath(sceneId: string): string {
  return `/scenes/${encodeURIComponent(sceneId)}/content`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function redactSecretText(value: string, secret?: string): string {
  let redacted = value
    .replace(/Bearer\s+[^"'\s]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization["'\s:=]+)[^"',}\s]+/gi, "$1[REDACTED]");
  if (secret) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

async function readResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}
