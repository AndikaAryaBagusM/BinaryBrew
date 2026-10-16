import messages from "./id.json";

// All UI text lives in id.json (Tech §4 rule 4, D20). Keys are checked at
// compile time; {placeholders} are filled from params and must all be given.
export type MessageKey = keyof typeof messages;
export type MessageParams = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function t(key: MessageKey, params: MessageParams = {}): string {
  return messages[key].replace(PLACEHOLDER, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing parameter "${name}" for message "${key}"`);
    }
    return String(value);
  });
}
