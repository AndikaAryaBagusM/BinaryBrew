import { t } from "@/i18n";

// Client side of the JSON routes (docs/02 §6), shared by the Counter and the
// owner area. Every call answers with data or with the server's error (code,
// Indonesian message, details); a network failure reads as the generic error
// with status 0.

// A server type as it arrives over JSON: dates become ISO strings.
export type Json<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

export type ApiError = {
  code?: string;
  message: string;
  details?: Record<string, unknown>;
};
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiError };

export async function api<T>(
  url: string,
  init: {
    method?: "GET" | "POST" | "PATCH" | "PUT";
    body?: unknown;
    headers?: HeadersInit;
  } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      cache: "no-store",
      headers: {
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, status: 0, error: { message: t("error.generic") } };
  }
  const body = await response.json().catch(() => null);
  if (response.ok)
    return { ok: true, status: response.status, data: body?.data };
  return {
    ok: false,
    status: response.status,
    error: body?.error ?? { message: t("error.generic") },
  };
}
