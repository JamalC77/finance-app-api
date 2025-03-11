import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to prevent caching of responses
 * Sets appropriate headers to prevent browsers from returning 304 responses
 */
export const noCache = (req: Request, res: Response, next: NextFunction) => {
  // Set headers to prevent caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  
  // Add a timestamp to the ETag to ensure it's always different
  const originalSend = res.send;
  res.send = function(body): Response {
    // Add unique timestamp to force new content
    if (!res.getHeader('ETag')) {
      res.setHeader('ETag', `W/"${Date.now().toString()}"`);
    }
    return originalSend.call(this, body);
  };
  
  next();
}; 