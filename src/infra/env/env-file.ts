import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export const ENV_FILE = ".env";
export const ENV_EXAMPLE_FILE = ".env.example";

export function ensureEnvFile(): boolean {
  if (fs.existsSync(ENV_FILE)) {
    dotenv.config({ path: ENV_FILE });
    return false;
  }

  if (!fs.existsSync(ENV_EXAMPLE_FILE)) {
    fs.writeFileSync(ENV_FILE, "", "utf8");
    dotenv.config({ path: ENV_FILE });
    return true;
  }

  fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
  dotenv.config({ path: ENV_FILE });
  return true;
}

export function updateEnvFile(values: Record<string, string>): void {
  ensureEnvFile();

  const absolutePath = path.resolve(ENV_FILE);
  const original = fs.readFileSync(absolutePath, "utf8");
  const lines = original.split(/\r?\n/);
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;

    const key = match[1];
    if (!(key in values)) return line;

    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(absolutePath, trimTrailingBlankLines(nextLines).join("\n") + "\n", "utf8");
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const copy = [...lines];
  while (copy.length > 0 && copy[copy.length - 1] === "") {
    copy.pop();
  }
  return copy;
}
