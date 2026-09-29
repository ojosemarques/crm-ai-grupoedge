import { createHash } from "node:crypto";

type Entry = { count: number; resetsAt: number };

export function createLocalRateLimiter(options: Readonly<{ limit: number; windowMs: number; now?: () => number }>) {
  const entries = new Map<string, Entry>();
  const now = options.now ?? Date.now;
  return {
    consume(rawIdentity: string) {
      const key = createHash("sha256").update(rawIdentity).digest("hex");
      const time = now();
      const current = entries.get(key);
      if (!current || current.resetsAt <= time) {
        entries.set(key, { count: 1, resetsAt: time + options.windowMs });
        return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
      }
      if (current.count >= options.limit) return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - time) / 1000)) };
      current.count += 1;
      return { allowed: true, remaining: options.limit - current.count, retryAfterSeconds: 0 };
    },
    clear() { entries.clear(); },
  };
}
