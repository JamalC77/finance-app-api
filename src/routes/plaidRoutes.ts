import { Router } from 'express';
import * as plaidController from '../controllers/plaidController';
import { auth } from '../middleware/authMiddleware';

const router = Router();

/**
 * @route   POST /api/plaid/create_link_token
 * @desc    Create a link token for Plaid Link
 * @access  Private
 */
router.post('/create_link_token', auth, plaidController.createLinkToken);

/**
 * @route   POST /api/plaid/exchange_public_token
 * @desc    Exchange public token for access token
 * @access  Private
 */
router.post('/exchange_public_token', auth, plaidController.exchangePublicToken);

/**
 * @route   GET /api/plaid/accounts
 * @desc    Get accounts for a user
 * @access  Private
 */
router.get('/accounts', auth, plaidController.getAccounts);

/**
 * @route   DELETE /api/plaid/accounts/:id
 * @desc    Remove an account for a user
 * @access  Private
 */
router.delete('/accounts/:id', auth, plaidController.removeAccount);

/**
 * @route   POST /api/plaid/sync_transactions
 * @desc    Sync transactions for a user
 * @access  Private
 */
router.post('/sync_transactions', auth, plaidController.syncTransactions);

/**
 * @route   GET /api/plaid/transactions
 * @desc    Get transactions for a user
 * @access  Private
 */
router.get('/transactions', auth, plaidController.getTransactions);

/**
 * @route   POST /api/plaid/categorize_transactions
 * @desc    Categorize transactions for a user
 * @access  Private
 */
router.post('/categorize_transactions', auth, plaidController.categorizeTransactions);

/**
 * @route   POST /api/plaid/webhook
 * @desc    Handle webhook for real-time updates
 * @access  Public (secured by Plaid signature verification)
 */
router.post('/webhook', plaidController.handleWebhook);

export default router; 