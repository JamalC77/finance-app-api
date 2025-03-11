import { Request, Response, NextFunction } from 'express';

// Interface for errors with status code
interface ErrorWithStatus extends Error {
  statusCode?: number;
  code?: string;
  meta?: any;
}

/**
 * API error handler middleware
 * Provides consistent error responses across the API
 */
export const apiErrorHandler = (
  err: ErrorWithStatus,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('API Error:', err);
  
  // Determine if this is an authentication error
  const isAuthRoute = req.originalUrl.includes('/api/auth');
  const isAuthError = err.message?.toLowerCase().includes('auth') || 
                     err.message?.toLowerCase().includes('token') ||
                     err.message?.toLowerCase().includes('permission');
  
  // For auth routes, ensure error handling is more robust
  if (isAuthRoute) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      status: 'error',
      message: err.message || 'Authentication error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
  
  // Handle Prisma errors
  if (err.code && err.code.startsWith('P')) {
    // Prisma error codes start with P
    return res.status(400).json({
      status: 'error',
      message: 'Database operation failed',
      detail: process.env.NODE_ENV === 'development' ? err.meta : undefined
    });
  }
  
  // Default error handling
  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
}; 