// Redis configuration (placeholder for future Redis implementation)
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  enabled: false, // Redis not currently in use
};

export default redisConfig;
