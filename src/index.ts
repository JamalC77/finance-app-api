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

// Simpler, more permissive CORS configuration for troubleshooting
app.use(cors({
  origin: true, // Allow all origins for now
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept']
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

// Explicit OPTIONS handler for auth login
app.options('/api/auth/login', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Origin,Accept');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});

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