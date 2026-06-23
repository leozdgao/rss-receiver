import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { Storage, StoredArticle } from "../../infra/sqlite/storage.js";

type DesktopContentItem = StoredArticle & {
  sourceType: "RSS";
};

type ServiceApp = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export function registerContentRoutes(app: ServiceApp, storage: Storage): void {
  app.get("/content-items", async () => ({
    items: storage.listArticles().map(toDesktopContentItem)
  }));

  app.get<{ Params: { id: string } }>("/content-items/:id", async (request, reply) => {
    const article = storage.getArticle(Number(request.params.id));
    if (!article) return reply.code(404).send({ error: "Content item not found" });
    return toDesktopContentItem(article);
  });

  app.get<{ Params: { id: string } }>("/content-items/:id/summary", async (request, reply) => {
    const summary = storage.getSummary(Number(request.params.id));
    if (!summary) return reply.code(404).send({ error: "Summary not found" });
    return summary;
  });
}

function toDesktopContentItem(article: StoredArticle): DesktopContentItem {
  return {
    ...article,
    sourceType: "RSS"
  };
}
