/**
 * Custom API error class for standardized error handling
 */
export class ApiError extends Error {
  statusCode: number;
  
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Format error response for consistent API error handling
 * 
 * @param error The error object
 * @returns Formatted error response
 */
export const formatErrorResponse = (error: any) => {
  // If it's already an ApiError, use its properties
  if (error instanceof ApiError) {
    return {
      success: false,
      error: {
        code: error.statusCode,
        message: error.message,
      }
    };
  }
  
  // Handle standard database errors
  if (error.code === 'P2002') {
    return {
      success: false,
      error: {
        code: 409,
        message: 'Resource already exists',
        details: error.meta?.target || error.message,
      }
    };
  }
  
  if (error.code === 'P2025') {
    return {
      success: false,
      error: {
        code: 404,
        message: 'Resource not found',
        details: error.meta?.cause || error.message,
      }
    };
  }
  
  // Default error formatting
  return {
    success: false,
    error: {
      code: error.statusCode || 500,
      message: error.message || 'Internal server error',
    }
  };
}; 