import crypto from "node:crypto";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function stableContentHash(parts: Array<string | undefined | null>): string {
  return sha256(parts.map((part) => part?.trim() ?? "").join("\n"));
}
