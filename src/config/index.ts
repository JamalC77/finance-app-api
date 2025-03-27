import redisConfig from './redis';

export {
  redisConfig
};

// Export default config object for backward compatibility
export const config = {
  redis: redisConfig
}; 