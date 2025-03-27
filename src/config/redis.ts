import dotenv from 'dotenv';

dotenv.config();

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  tls?: boolean;
  db?: number;
  keyPrefix?: string;
}

const redisConfig: RedisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  username: process.env.REDIS_USERNAME,
  tls: process.env.REDIS_TLS === 'true',
  db: parseInt(process.env.REDIS_DB || '0', 10),
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'finance-app:'
};

export default redisConfig; 