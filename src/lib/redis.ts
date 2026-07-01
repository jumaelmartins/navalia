import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as { redis?: Redis }

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0', {
      maxRetriesPerRequest: 2,
    })
  }
  return globalForRedis.redis
}
