import cron from "node-cron";
import type { AppConfig } from "../infra/env/config.js";
import type { Storage } from "../infra/sqlite/storage.js";
import { logError, logInfo } from "../shared/logger.js";
import { runOnce } from "./receiver.js";

export async function startDaemon(config: AppConfig, storage: Storage): Promise<void> {
  let running = false;

  const tick = async () => {
    if (running) {
      logInfo("Previous run is still active; skipping this tick.");
      return;
    }

    running = true;
    try {
      const stats = await runOnce(config, storage);
      logInfo("Daemon tick complete.", stats);
    } catch (error) {
      logError("Daemon tick failed.", error);
    } finally {
      running = false;
    }
  };

  await tick();
  cron.schedule(config.fetchIntervalCron, tick);
  logInfo("RSS receiver daemon scheduled.", { cron: config.fetchIntervalCron });
}
