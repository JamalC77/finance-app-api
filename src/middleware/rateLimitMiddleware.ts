import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyGenerator?: (req: Request) => string;
  skipFailedRequests?: boolean;
  message?: string;
}

// In-memory fallback if DB is slow/unavailable
const memoryStore = new Map<string, { count: number; resetTime: number }>();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (now > value.resetTime) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Get client IP address, handling proxies
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0];
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Create a rate limiting middleware
 */
export function createRateLimiter(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => getClientIp(req),
    message = 'Too many requests. Please try again later.',
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const endpoint = req.path;
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

    try {
      // Try in-memory first for speed
      const memKey = `${key}:${endpoint}:${windowStart.getTime()}`;
      const memRecord = memoryStore.get(memKey);

      if (memRecord) {
        if (memRecord.count >= maxRequests) {
          res.setHeader('X-RateLimit-Limit', maxRequests);
          res.setHeader('X-RateLimit-Remaining', 0);
          res.setHeader('X-RateLimit-Reset', Math.ceil(memRecord.resetTime / 1000));
          res.setHeader('Retry-After', Math.ceil((memRecord.resetTime - now) / 1000));

          return res.status(429).json({
            error: 'rate_limit_exceeded',
            message,
            retryAfter: Math.ceil((memRecord.resetTime - now) / 1000),
          });
        }

        memRecord.count++;
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - memRecord.count));
        res.setHeader('X-RateLimit-Reset', Math.ceil(memRecord.resetTime / 1000));

        // Also persist to DB in background (non-blocking)
        persistRateLimit(key, endpoint, windowStart, memRecord.count).catch(console.error);

        return next();
      }

      // No memory record, create one
      const resetTime = windowStart.getTime() + windowMs;
      memoryStore.set(memKey, { count: 1, resetTime });

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000));

      // Persist to DB in background
      persistRateLimit(key, endpoint, windowStart, 1).catch(console.error);

      next();
    } catch (error) {
      // If rate limiting fails, allow the request (fail open)
      console.error('[RateLimit] Error checking rate limit:', error);
      next();
    }
  };
}

/**
 * Persist rate limit record to database (for analytics and cross-instance limiting)
 */
async function persistRateLimit(
  identifier: string,
  endpoint: string,
  windowStart: Date,
  count: number
): Promise<void> {
  try {
    await prisma.rateLimitRecord.upsert({
      where: {
        identifier_endpoint_windowStart: {
          identifier,
          endpoint,
          windowStart,
        },
      },
      update: { count },
      create: {
        identifier,
        endpoint,
        windowStart,
        count,
      },
    });
  } catch (error) {
    // Silently fail - in-memory is the source of truth
  }
}

// Pre-configured rate limiters for different use cases

/**
 * Standard API rate limiter: 60 requests per minute
 */
export const standardRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60,
  message: 'Too many requests. Please wait a moment.',
});

/**
 * Chat rate limiter: 20 messages per minute (prevents spam/abuse)
 */
export const chatRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20,
  message: 'You\'re sending messages too quickly. Please slow down.',
});

/**
 * Strict rate limiter: 10 requests per minute (for expensive operations)
 */
export const strictRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
  message: 'Rate limit exceeded. Please try again in a minute.',
});

/**
 * Session start rate limiter: 5 new sessions per IP per hour
 */
export const sessionStartRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 5,
  message: 'Too many new conversations. Please try again later.',
});
