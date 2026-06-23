import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listActivity } from "../../src/app/activity/activity-runner.js";
import { Storage } from "../../src/infra/sqlite/storage.js";

describe("listActivity", () => {
  it("translates jobs into user-facing activity", () => {
    const storage = new Storage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-activity-")), "test.sqlite"));
    storage.migrate();
    const job = storage.createJob({ type: "run-once", trigger: "api" });
    storage.markJobDone(job.id, { inserted: 3 });

    const activity = listActivity(storage);

    expect(activity.items[0]).toMatchObject({
      kind: "Fetch",
      severity: "Info",
      title: "Fetch completed"
    });
    expect(activity.items[0].technical.kind).toBe("job");
    storage.close();
  });
});
