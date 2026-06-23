import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import { listActivity } from "../../app/activity/activity-runner.js";
import type { Storage } from "../../infra/sqlite/storage.js";

type ServiceApp = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export function registerActivityRoutes(app: ServiceApp, storage: Storage): void {
  app.get("/activity", async () => listActivity(storage));
}
