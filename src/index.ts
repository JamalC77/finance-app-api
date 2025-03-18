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

// Define allowed origins
const allowedOrigins = [
  'http://localhost:3000',              // Local development
  'https://localhost:3000',             // Local development with HTTPS
  'http://127.0.0.1:3000',              // Local alternative
  'https://thecfoline.com', // Railway frontend
  'https://cfo-line-api.up.railway.app',     // Vercel deployment (if used)
  process.env.FRONTEND_URL || '',      // Dynamic frontend URL from environment
  '*'                                  // Fallback (remove in production)
].filter(Boolean); // Remove empty strings

// Configure CORS with specific origins
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Check if the origin is allowed
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // Log unauthorized attempts in development
    if (isDev) {
      console.log(`CORS blocked request from: ${origin}`);
    }
    
    callback(new Error('Not allowed by CORS'));
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running in ${env.NODE_ENV} mode on port ${PORT}`);
});

// Export for serverless deployment
export default app; 