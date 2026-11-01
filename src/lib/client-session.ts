// The browser's random id (Tech §5): sent with every self-order so the server
// can cap open orders per browser (BR-11). Not personal data (D19). Kept in
// localStorage so every tab of this browser shares it.

export const CLIENT_SESSION_KEY = "bb.clientSession";

const VALID = /^[A-Za-z0-9_-]{16,64}$/;

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

// 128 random bits as base64url. crypto.getRandomValues also works over plain
// HTTP on the LAN, unlike crypto.randomUUID.
export function newClientToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Blocked storage (private mode) gives a fresh id each time; the cap then
// applies per request only, which the per-IP rate limit still bounds.
export function getClientSession(storage: KeyValueStorage): string {
  try {
    const stored = storage.getItem(CLIENT_SESSION_KEY);
    if (stored && VALID.test(stored)) return stored;
  } catch {
    return newClientToken();
  }
  const id = newClientToken();
  try {
    storage.setItem(CLIENT_SESSION_KEY, id);
  } catch {
    // Storage full or blocked.
  }
  return id;
}
