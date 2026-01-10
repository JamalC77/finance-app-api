import { Router } from 'express';
import * as publicController from '../controllers/publicController';
import { leadChatController } from '../controllers/leadChatController';
import {
  chatRateLimiter,
  sessionStartRateLimiter
} from '../middleware/rateLimitMiddleware';

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
// LEAD CHAT ROUTES
// ============================================

/**
 * @route   POST /api/public/chat/start
 * @desc    Start a new chat session or resume existing one
 * @access  Public (rate limited: 5 new sessions per IP per hour)
 */
router.post(
  '/chat/start',
  sessionStartRateLimiter,
  (req, res, next) => {
    leadChatController.startSession(req, res).catch(next);
  }
);

/**
 * @route   POST /api/public/chat/message
 * @desc    Send a message in an existing chat session
 * @access  Public (rate limited: 20 messages per minute)
 */
router.post(
  '/chat/message',
  chatRateLimiter,
  (req, res, next) => {
    leadChatController.sendMessage(req, res).catch(next);
  }
);

/**
 * @route   POST /api/public/chat/calendly-clicked
 * @desc    Track when user clicks the Calendly link
 * @access  Public
 */
router.post(
  '/chat/calendly-clicked',
  chatRateLimiter,
  (req, res, next) => {
    leadChatController.markCalendlyClicked(req, res).catch(next);
  }
);

/**
 * @route   GET /api/public/chat/calendly-url
 * @desc    Get the Calendly booking URL
 * @access  Public
 */
router.get('/chat/calendly-url', (req, res) => {
  leadChatController.getCalendlyUrl(req, res);
});

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