import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../models/prisma';
import { env } from '../utils/env';

// Define JWT payload interface
interface JwtPayload {
  id: string;
  email: string;
  organizationId: string;
  role: string;
}

// Extend the Express Request type to include user information
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

interface ErrorWithStatus extends Error {
  statusCode?: number;
}

/**
 * Global error handling middleware
 */
export const errorHandler = (
  err: ErrorWithStatus,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  
  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

/**
 * Authentication middleware
 * Verifies JWT tokens and attaches user information to the request
 */
export const auth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    
    if (!decoded.id) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role
    };
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

// Export auth as authMiddleware for backward compatibility
export const authMiddleware = auth; 