import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/authRoutes';
import organizationRoutes from './routes/organizationRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import contactRoutes from './routes/contactRoutes';
import paymentRoutes from './routes/paymentRoutes';
import transactionRoutes from './routes/transactionRoutes';
import userRoutes from './routes/userRoutes';
import accountRoutes from './routes/accountRoutes';
import categoryRoutes from './routes/categoryRoutes';
import reportRoutes from './routes/reportRoutes';
import publicRoutes from './routes/publicRoutes';
import quickbooksRoutes from './routes/quickbooksRoutes';
import insightsRoutes from './routes/insightsRoutes';

// Initialize express app
const app = express();

// Apply middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' })); // Parse JSON request body
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded request body
app.use(cookieParser()); // Parse cookies
app.use(compression()); // Compress responses
app.use(morgan('dev')); // Log HTTP requests

// Apply routes
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/public', publicRoutes); // Public API routes (don't require authentication)
app.use('/api/quickbooks', quickbooksRoutes); // Add QuickBooks routes
app.use('/api/insights', insightsRoutes); // Add insights routes

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'API is running' });
});

// 404 handler for undefined routes
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Resource not found' });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

export default app; 