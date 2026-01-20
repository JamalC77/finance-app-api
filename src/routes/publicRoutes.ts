import { Router } from 'express';
import * as publicController from '../controllers/publicController';

const router = Router();

// ============================================
// INVOICE & PAYMENT ROUTES
// ============================================

/**
 * @route   GET /api/public/invoices/:id
 * @desc    Get a public invoice by ID
 * @access  Public
 */
router.get('/invoices/:id', publicController.getPublicInvoice);

/**
 * @route   POST /api/public/payments/create-payment-intent
 * @desc    Create a Stripe payment intent for a public invoice
 * @access  Public
 */
router.post('/payments/create-payment-intent', publicController.createPublicPaymentIntent);

// ============================================
// HEALTH CHECK
// ============================================

/**
 * @route   GET /api/public/ping
 * @desc    Simple health check endpoint
 * @access  Public
 */
router.get('/ping', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Public API is running' });
});

export default router; 