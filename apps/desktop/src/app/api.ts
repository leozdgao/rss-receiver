/// <reference types="vite/client" />

export type ApiConfig = {
  baseUrl: string;
  token?: string;
};

const fallbackBaseUrl = "http://127.0.0.1:3766";
let resolvedBaseUrl: Promise<string> | undefined;

export const config: ApiConfig = {
  baseUrl: import.meta.env.VITE_RSS_RECEIVER_API_URL ?? fallbackBaseUrl,
  token: import.meta.env.VITE_RSS_RECEIVER_API_TOKEN
};

export async function apiGet<T>(path: string): Promise<T> {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: config.token ? { authorization: `Bearer ${config.token}` } : undefined
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function getBaseUrl(): Promise<string> {
  if (import.meta.env.VITE_RSS_RECEIVER_API_URL) return config.baseUrl;
  resolvedBaseUrl ??= resolveRuntimeBaseUrl();
  return resolvedBaseUrl;
}

async function resolveRuntimeBaseUrl(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number | null>("read_runtime_port");
    if (typeof port === "number" && Number.isFinite(port) && port > 0) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // Browser-only development and first-run states fall back to the default API URL.
  }
  return fallbackBaseUrl;
}
