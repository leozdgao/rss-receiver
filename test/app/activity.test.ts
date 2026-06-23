import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listActivity } from "../../src/app/activity/activity-runner.js";
import { Storage } from "../../src/infra/sqlite/storage.js";

describe("listActivity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("honors requested limits above the storage default", () => {
    const storage = new Storage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-activity-")), "test.sqlite"));
    storage.migrate();

    for (let index = 0; index < 125; index += 1) {
      storage.createJob({ type: "run-once", trigger: "api" });
    }

    const activity = listActivity(storage, 150);

    expect(activity.items).toHaveLength(125);
    storage.close();
  });

  it("orders activity by occurred time", () => {
    vi.useFakeTimers();
    const storage = new Storage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-activity-")), "test.sqlite"));
    storage.migrate();

    vi.setSystemTime(new Date("2026-06-23T00:00:00.000Z"));
    const earlierCreated = storage.createJob({ type: "run-once", trigger: "api" });
    vi.setSystemTime(new Date("2026-06-23T00:00:01.000Z"));
    const laterCreated = storage.createJob({ type: "summarize", trigger: "api" });
    vi.setSystemTime(new Date("2026-06-23T00:00:10.000Z"));
    storage.markJobDone(laterCreated.id, {});
    vi.setSystemTime(new Date("2026-06-23T00:00:20.000Z"));
    storage.markJobDone(earlierCreated.id, {});

    const activity = listActivity(storage);

    expect(activity.items.map((item) => item.technical.id)).toEqual([earlierCreated.id, laterCreated.id]);
    expect(activity.items.map((item) => item.occurredAt)).toEqual([
      "2026-06-23T00:00:20.000Z",
      "2026-06-23T00:00:10.000Z"
    ]);
    storage.close();
  });

  it("orders equal occurred times by id", () => {
    const storage = {
      listJobs: () => [
        {
          id: "job-b",
          type: "run-once",
          status: "done",
          createdAt: "2026-06-23T00:00:00.000Z",
          finishedAt: "2026-06-23T00:00:10.000Z"
        },
        {
          id: "job-a",
          type: "summarize",
          status: "done",
          createdAt: "2026-06-23T00:00:01.000Z",
          finishedAt: "2026-06-23T00:00:10.000Z"
        }
      ]
    } as unknown as Storage;

    const activity = listActivity(storage);

    expect(activity.items.map((item) => item.technical.id)).toEqual(["job-a", "job-b"]);
  });
});
