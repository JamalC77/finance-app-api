import { Router } from 'express';
import * as reconciliationController from '../controllers/reconciliationController';
import { auth } from '../middleware/authMiddleware';

const router = Router();

/**
 * @route   GET /api/reconciliation/accounts/:id/statements
 * @desc    Get reconciliation statements for an account
 * @access  Private
 */
router.get('/accounts/:id/statements', auth, reconciliationController.getStatements);

/**
 * @route   POST /api/reconciliation/accounts/:id/statements
 * @desc    Create a new reconciliation statement
 * @access  Private
 */
router.post('/accounts/:id/statements', auth, reconciliationController.createStatement);

/**
 * @route   GET /api/reconciliation/statements/:id
 * @desc    Get a reconciliation statement by ID
 * @access  Private
 */
router.get('/statements/:id', auth, reconciliationController.getStatement);

/**
 * @route   POST /api/reconciliation/statements/:id/import
 * @desc    Import transactions from a CSV/OFX file
 * @access  Private
 */
router.post('/statements/:id/import', auth, reconciliationController.importStatementTransactions);

/**
 * @route   POST /api/reconciliation/statements/:id/match
 * @desc    Auto-match transactions
 * @access  Private
 */
router.post('/statements/:id/match', auth, reconciliationController.matchTransactions);

/**
 * @route   POST /api/reconciliation/transactions/:id/reconcile
 * @desc    Reconcile a transaction
 * @access  Private
 */
router.post('/transactions/:id/reconcile', auth, reconciliationController.reconcileTransaction);

/**
 * @route   POST /api/reconciliation/transactions/:id/unmatch
 * @desc    Unmatch a transaction
 * @access  Private
 */
router.post('/transactions/:id/unmatch', auth, reconciliationController.unmatchTransaction);

/**
 * @route   POST /api/reconciliation/statements/:id/complete
 * @desc    Complete reconciliation
 * @access  Private
 */
router.post('/statements/:id/complete', auth, reconciliationController.completeReconciliation);

export default router; 