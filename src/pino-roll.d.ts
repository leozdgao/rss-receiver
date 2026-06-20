// pino-roll 没有自带 TypeScript 类型声明,这里补一份最小的 ambient 声明。
declare module "pino-roll" {
  import type { Writable } from "node:stream";
  const build: (options: Record<string, unknown>) => Promise<Writable>;
  export default build;
}
