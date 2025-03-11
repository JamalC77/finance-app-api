import { Request, Response, NextFunction } from 'express';

/**
 * Async handler utility for route handlers
 * Wraps async route handlers in a try-catch block and passes errors to next()
 * This prevents unhandled promise rejections from crashing the server
 * 
 * Usage: asyncHandler(async (req, res) => { ... })
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Async handler utility with isolated error handling
 * This version includes a fallback response in case of error,
 * preventing errors in one route from affecting others.
 * 
 * Usage: isolatedHandler(async (req, res) => { ... }, fallbackData)
 */
export const isolatedHandler = (fn: Function, fallbackData: any = null) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      console.error(`Error in route ${req.method} ${req.originalUrl}:`, error);
      
      // Only pass to next error handler if the response hasn't been sent yet
      if (!res.headersSent) {
        // For critical paths like authentication, pass to the error handler
        if (req.originalUrl.includes('/api/auth')) {
          return next(error);
        }
        
        // For non-critical routes, return a fallback response
        return res.status(500).json({
          status: 'error',
          message: 'An error occurred while processing your request',
          fallback: fallbackData
        });
      }
    }
  };
}; 