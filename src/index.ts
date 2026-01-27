import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { env, isDev } from './utils/env';
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
import publicRoutes from './routes/publicRoutes';
import publicChatRoutes from './routes/publicChatRoutes';
import prospectRoutes from './routes/prospectRoutes';
import snowflakeRoutes from './routes/snowflakeRoutes';
import subscriptionRoutes from './routes/subscriptionRoutes';
import aiCfoRoutes from './routes/aiCfoRoutes';

// Create Express app
const app = express();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
})); // Security headers with less strict CORS policy

// CORS configuration - use FRONTEND_URL in production, allow all in dev
const allowedOrigins = isDev
  ? ['http://localhost:3000', 'http://127.0.0.1:3000']
  : [env.FRONTEND_URL].filter(Boolean);

app.use(cors({
  origin: isDev ? true : allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept'],
  credentials: true
}));

// Body parsing middleware - place this BEFORE routes
app.use(express.json({ limit: '50mb' })); // Parse JSON bodies with increased limit
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Parse URL-encoded bodies with increased limit

// Request logger for debugging
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT') {
    console.log(`${req.method} ${req.url} - Content-Type: ${req.headers['content-type']}`);
  }
  next();
});

app.use(morgan(isDev ? 'dev' : 'combined')); // Logging

// Handle preflight requests for all routes
app.options('*', (req, res) => {
  res.sendStatus(204);
});

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
app.use('/api/snowflake', noCache, snowflakeRoutes);
app.use('/api/subscriptions', noCache, subscriptionRoutes);
app.use('/api/ai-cfo', noCache, aiCfoRoutes);

// Public routes (no auth required for invoice viewing/payment)
app.use('/api/public', publicRoutes);

// Public chat routes (no auth required for lead gen chat)
app.use('/api/public/chat', publicChatRoutes);

// Prospect intelligence pages (personalized landing pages)
app.use('/api/public/prospect', prospectRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check received');
  res.status(200).json({ status: 'OK', environment: env.NODE_ENV });
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