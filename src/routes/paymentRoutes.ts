import { Router } from 'express';
import * as paymentController from '../controllers/paymentController';
import { auth } from '../middleware/authMiddleware';

const router = Router();

/**
 * @route   POST /api/payments/create-payment-intent
 * @desc    Create a Stripe payment intent for an invoice
 * @access  Private
 */
router.post('/create-payment-intent', auth, paymentController.createPaymentIntent);

/**
 * @route   POST /api/payments/webhook
 * @desc    Handle Stripe webhook events
 * @access  Public (secured by Stripe signature verification)
 */
router.post('/webhook', paymentController.handleStripeWebhook);

/**
 * @route   GET /api/payments/payment-methods
 * @desc    Get saved payment methods for a customer
 * @access  Private
 */
router.get('/payment-methods', auth, paymentController.getPaymentMethods);

/**
 * @route   POST /api/payments/setup-intent
 * @desc    Create a setup intent to save a payment method
 * @access  Private
 */
router.post('/setup-intent', auth, paymentController.createSetupIntent);

/**
 * @route   POST /api/payments/remove-payment-method
 * @desc    Remove a saved payment method
 * @access  Private
 */
router.post('/remove-payment-method', auth, paymentController.removePaymentMethod);

/**
 * @route   GET /api/payments/invoice/:id/payment-link
 * @desc    Get a payment link for an invoice
 * @access  Private
 */
router.get('/invoice/:id/payment-link', auth, paymentController.getInvoicePaymentLink);

/**
 * @route   POST /api/payments/process
 * @desc    Process a payment for an invoice
 * @access  Private
 */
router.post('/process', auth, paymentController.processPayment);

/**
 * @route   POST /api/payments/attach-payment-method
 * @desc    Attach a payment method to a customer
 * @access  Private
 */
router.post('/attach-payment-method', auth, paymentController.attachPaymentMethod);

/**
 * @route   GET /api/payments/invoice/:id/checkout
 * @desc    Create a checkout session for an invoice
 * @access  Private
 */
router.get('/invoice/:id/checkout', auth, paymentController.createCheckoutSession);

/**
 * @route   POST /api/payments/manual
 * @desc    Process a manual payment for an invoice
 * @access  Private
 */
router.post('/manual', auth, paymentController.processManualPayment);

export default router; 