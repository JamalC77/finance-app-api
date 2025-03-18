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
app.use(helmet()); // Security headers
app.use(cors({
  origin: env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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

// Health check endpoint - make sure this is properly implemented
app.get('/health', (req, res) => {
  console.log('Health check received');
  res.status(200).json({ status: 'OK', environment: env.NODE_ENV });
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