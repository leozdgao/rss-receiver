import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSourcesYaml, syncSourcesFromYaml } from "../../src/app/source-sync.js";
import { Storage } from "../../src/infra/sqlite/storage.js";

describe("parseSourcesYaml", () => {
  it("parses source entries with optional fields", () => {
    expect(parseSourcesYaml(`
sources:
  - name: LangChain Blog
    url: https://www.langchain.com/blog/rss.xml
    category: AI
    summarySkill: product-update
  - name: Disabled Feed
    url: "https://example.com/feed.xml"
    enabled: false
`)).toEqual([
      {
        name: "LangChain Blog",
        url: "https://www.langchain.com/blog/rss.xml",
        enabled: true,
        category: "AI",
        summarySkill: "product-update"
      },
      {
        name: "Disabled Feed",
        url: "https://example.com/feed.xml",
        enabled: false,
        category: undefined,
        summarySkill: undefined
      }
    ]);
  });
});

describe("syncSourcesFromYaml", () => {
  it("upserts YAML sources and disables sources missing from the file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rss-sources-"));
    const storage = new Storage(path.join(dir, "test.sqlite"));
    storage.migrate();
    storage.upsertSource({
      name: "Old Feed",
      url: "https://old.example.com/rss.xml",
      enabled: true
    });
    const yamlPath = path.join(dir, "sources.yaml");
    fs.writeFileSync(yamlPath, `
sources:
  - name: LangChain Blog
    url: https://www.langchain.com/blog/rss.xml
  - name: OpenAI Blog
    url: https://openai.com/news/rss.xml
    category: AI
`, "utf8");

    const stats = syncSourcesFromYaml(storage, yamlPath);

    expect(stats).toMatchObject({ parsed: 2, upserted: 2, disabled: 1, enabled: 2 });
    expect(storage.listEnabledSources().map((source) => source.name)).toEqual([
      "LangChain Blog",
      "OpenAI Blog"
    ]);
    expect(storage.listSources().find((source) => source.name === "Old Feed")).toMatchObject({
      enabled: false
    });
    storage.close();
  });
});
