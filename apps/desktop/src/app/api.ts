/// <reference types="vite/client" />

export type ApiConfig = {
  baseUrl: string;
  token?: string;
};

export const config: ApiConfig = {
  baseUrl: import.meta.env.VITE_RSS_RECEIVER_API_URL ?? "http://127.0.0.1:3766",
  token: import.meta.env.VITE_RSS_RECEIVER_API_TOKEN
};

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: config.token ? { authorization: `Bearer ${config.token}` } : undefined
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
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
