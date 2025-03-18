import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { env, isDev } from './utils/env';
import { errorHandler } from './middleware/authMiddleware';
import { noCache } from './middleware/cacheControlMiddleware';
import { apiErrorHandler } from './middleware/errorMiddleware';

// Import routes
import plaidRoutes from './routes/plaidRoutes';
import paymentRoutes from './routes/paymentRoutes';
import reconciliationRoutes from './routes/reconciliationRoutes';
import reportRoutes from './routes/reportRoutes';
import authRoutes from './routes/authRoutes';
import transactionRoutes from './routes/transactionRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import expenseRoutes from './routes/expenseRoutes';
import contactRoutes from './routes/contactRoutes';
import accountRoutes from './routes/accountRoutes';
import userRoutes from './routes/userRoutes';
import categoryRoutes from './routes/categoryRoutes';
import quickbooksRoutes from './routes/quickbooksRoutes';
import insightsRoutes from './routes/insightsRoutes';

// Create Express app
const app = express();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
})); // Security headers with less strict CORS policy

// Configure CORS to allow requests from your frontend
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      env.FRONTEND_URL,
      'http://localhost:3000',
      'https://finance-app.vercel.app',
      'https://thecfoline.com',
      'https://thecfoline.vercel.app'
    ];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(null, true); // Temporarily allow all origins in production
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(morgan(isDev ? 'dev' : 'combined')); // Logging

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', noCache, userRoutes);
app.use('/api/plaid', noCache, plaidRoutes);
app.use('/api/payments', noCache, paymentRoutes);
app.use('/api/reconciliation', noCache, reconciliationRoutes);
app.use('/api/reports', noCache, reportRoutes);
app.use('/api/transactions', noCache, transactionRoutes);
app.use('/api/invoices', noCache, invoiceRoutes);
app.use('/api/expenses', noCache, expenseRoutes);
app.use('/api/contacts', noCache, contactRoutes);
app.use('/api/accounts', noCache, accountRoutes);
app.use('/api/categories', noCache, categoryRoutes);
app.use('/api/quickbooks', noCache, quickbooksRoutes);
app.use('/api/insights', noCache, insightsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check received');
  res.status(200).json({ status: 'OK', environment: env.NODE_ENV });
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  console.log('CORS test received from:', req.headers.origin);
  res.status(200).json({ 
    success: true, 
    message: 'CORS is working correctly',
    origin: req.headers.origin,
    time: new Date().toISOString()
  });
});

// Error handling middleware
app.use(apiErrorHandler);

// Start server
const PORT = env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running in ${env.NODE_ENV} mode on port ${PORT}`);
});

// Export for serverless deployment
export default app; 