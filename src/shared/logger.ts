import { Transform } from "node:stream";
import pino, { type Logger } from "pino";
import buildRoll from "pino-roll";

export type LogFields = Record<string, unknown>;

// pino 默认不会序列化 Error;必须显式注册 err serializer,
// 否则 logError 传的 Error 会被 JSON.stringify 成 {},丢失 message 和 stack。
const serializers = { err: pino.stdSerializers.err };

const LEVEL_LABELS: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL"
};

const RESERVED_KEYS = ["level", "time", "pid", "hostname", "msg"];

// 复刻旧 logger 的格式:[ISO] LEVEL message {fields}
function formatLine(obj: Record<string, unknown>): string {
  const time = new Date(obj.time as number).toISOString();
  const level = LEVEL_LABELS[obj.level as number] ?? "INFO";
  const msg = (obj.msg as string | undefined) ?? "";
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!RESERVED_KEYS.includes(key)) fields[key] = value;
  }
  const meta = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  return `[${time}] ${level} ${msg}${meta}\n`;
}

// 把 pino 的 JSON 行转换成旧格式文本行的流。
function createFormatter(): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const line = chunk.toString().trim();
      if (!line) return callback();
      try {
        callback(null, formatLine(JSON.parse(line) as Record<string, unknown>));
      } catch {
        callback(null, `${line}\n`); // 非 pino JSON(如 transport 报错)原样直通
      }
    }
  });
}

// 默认实例:格式化文本写 stdout,供 CLI 一次性命令(run-once/summarize 等)使用。
const defaultFormatter = createFormatter();
defaultFormatter.pipe(process.stdout);
let active: Logger = pino({ level: process.env.LOG_LEVEL ?? "info", serializers }, defaultFormatter);

// server 启动时调用:切换到按天轮转的文件日志,格式与旧 logger 一致。
export async function configureLogger(opts: {
  level: string;
  file: string;
  retentionDays: number;
}): Promise<Logger> {
  const formatter = createFormatter();
  const destination = await buildRoll({
    file: opts.file,
    frequency: "daily",
    dateFormat: "yyyy-MM-dd",
    mkdir: true,
    // 每天轮转一个文件,count ≈ 保留天数;removeOtherLogFiles 让重启后也清理历史文件。
    limit: { count: opts.retentionDays, removeOtherLogFiles: true }
  });
  formatter.pipe(destination);
  active = pino({ level: opts.level, serializers }, formatter);
  return active;
}

export function getLogger(): Logger {
  return active;
}

// 签名与旧实现完全一致 —— 7 个调用点无需改动。
export function logInfo(message: string, fields?: LogFields): void {
  active.info(fields ?? {}, message);
}

export function logError(message: string, error: unknown, fields?: LogFields): void {
  // 放在保留键 `err` 下,经 serializers.err 输出 message/stack/type。
  active.error(
    { ...fields, err: error instanceof Error ? error : new Error(String(error)) },
    message
  );
}
