import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../utils/env';

// JWT Payload interface 
interface JwtPayload {
  id: string;
  email: string;
  organizationId: string;
  role: string;
}

// Extend Express Request to include user property
// This is already defined in authMiddleware.ts, so we don't need to redefine it here
// declare global {
//   namespace Express {
//     interface Request {
//       user?: JwtPayload;
//     }
//   }
// }

/**
 * JWT Authentication Middleware
 * Verifies the JWT token from the request headers and sets the user in the request object
 */
export const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ message: 'No authorization token provided' });
    }
    
    const token = authHeader.split(' ')[1]; // "Bearer TOKEN"
    
    if (!token) {
      return res.status(401).json({ message: 'Invalid authorization format' });
    }
    
    // Verify token
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    
    // Ensure organizationId is set
    if (!decoded.organizationId) {
      return res.status(401).json({ message: 'Invalid token: missing organizationId' });
    }
    
    req.user = decoded;
    
    next();
  } catch (error) {
    console.error('JWT Authentication error:', error);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}; 