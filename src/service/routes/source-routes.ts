import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { Source, Storage } from "../../infra/sqlite/storage.js";

type DesktopSource = Source & {
  type: "RSS";
};

type ServiceApp = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export function registerSourceRoutes(app: ServiceApp, storage: Storage): void {
  app.get("/sources", async () => ({
    items: storage.listSources().map(toDesktopSource)
  }));
}

function toDesktopSource(source: Source): DesktopSource {
  return {
    ...source,
    type: "RSS"
  };
}
