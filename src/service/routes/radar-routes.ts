import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import { buildRadar } from "../../app/radar/radar-runner.js";
import type { Storage } from "../../infra/sqlite/storage.js";

const DESKTOP_RADAR_WINDOW_DAYS = 7;

type ServiceApp = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export function registerRadarRoutes(app: ServiceApp, storage: Storage): void {
  app.get("/radar", async () => buildRadar(storage, { windowDays: DESKTOP_RADAR_WINDOW_DAYS }));

  app.get("/radar/topics", async () => ({
    items: buildRadar(storage, { windowDays: DESKTOP_RADAR_WINDOW_DAYS }).topics
  }));

  app.post("/radar/refresh", async (_request, reply) => {
    const radar = buildRadar(storage, { windowDays: DESKTOP_RADAR_WINDOW_DAYS });
    return reply.code(202).send({ radar });
  });
}
