import winston from "winston";
import { env } from "./env";

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    env.NODE_ENV === "development"
      ? winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            let metaStr = "";

            if (Object.keys(meta).length) {
              const seen = new WeakSet();
              const safe = JSON.stringify(meta, (_k, v) => {
                if (typeof v === "object" && v !== null) {
                  if (seen.has(v)) return "[Circular]";
                  seen.add(v);
                }

                return v;
              });

              metaStr = ` ${safe}`;
            }

            return `${timestamp} [${level}]: ${message}${metaStr}`;
          })
        )
      : winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});
