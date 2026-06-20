import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { SourceInput, Storage } from "../infra/sqlite/storage.js";
import { logInfo } from "../shared/logger.js";

export type SourceYamlEntry = SourceInput;

export type SyncSourcesStats = {
  file: string;
  parsed: number;
  upserted: number;
  disabled: number;
  enabled: number;
};

export function syncSourcesFromYaml(storage: Storage, filePath = "sources.yaml"): SyncSourcesStats {
  const resolvedPath = path.resolve(filePath);
  const sources = parseSourcesYaml(fs.readFileSync(resolvedPath, "utf8"), resolvedPath);
  const seenUrls = new Set<string>();

  for (const source of sources) {
    if (seenUrls.has(source.url)) {
      throw new Error(`Duplicate source url in ${resolvedPath}: ${source.url}`);
    }
    seenUrls.add(source.url);
  }

  for (const source of sources) {
    storage.upsertSource(source);
  }
  const disabled = storage.disableSourcesNotInUrls([...seenUrls]);
  const enabled = storage.listEnabledSources().length;
  const stats: SyncSourcesStats = {
    file: resolvedPath,
    parsed: sources.length,
    upserted: sources.length,
    disabled,
    enabled
  };
  logInfo("SQLite sources synced from YAML.", stats);
  return stats;
}

export function parseSourcesYaml(content: string, filePath = "sources.yaml"): SourceYamlEntry[] {
  const parsed = YAML.parse(content) as unknown;
  if (!isRecord(parsed)) throw new Error(`${filePath}: expected a YAML object.`);
  if (!Array.isArray(parsed.sources)) throw new Error(`${filePath}: expected "sources" to be a list.`);
  return parsed.sources.map((source, index) => normalizeSourceEntry(source, filePath, index + 1));
}

function normalizeSourceEntry(source: unknown, filePath: string, index: number): SourceYamlEntry {
  if (!isRecord(source)) throw new Error(`${filePath}: source #${index} must be an object.`);
  assertKnownSourceFields(source, filePath, index);
  const name = readString(source.name);
  const url = readString(source.url);
  const category = readOptionalString(source.category);
  const summarySkill = readOptionalString(source.summarySkill ?? source.summary_skill);
  const enabled = readOptionalBoolean(source.enabled, filePath, index);
  if (!name) throw new Error(`${filePath}: source #${index} is missing name.`);
  if (!url) throw new Error(`${filePath}: source #${index} is missing url.`);
  try {
    new URL(url);
  } catch {
    throw new Error(`${filePath}: source #${index} has invalid url: ${url}`);
  }
  return {
    name,
    url,
    enabled,
    category,
    summarySkill
  };
}

function assertKnownSourceFields(source: Record<string, unknown>, filePath: string, index: number): void {
  const allowed = new Set(["name", "url", "enabled", "category", "summarySkill", "summary_skill"]);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) {
      throw new Error(`${filePath}: source #${index} has unsupported field "${key}".`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value);
  return text || undefined;
}

function readOptionalBoolean(value: unknown, filePath: string, index: number): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  throw new Error(`${filePath}: source #${index} enabled must be a boolean.`);
}
