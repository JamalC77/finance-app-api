import express from 'express';
import { 
  getAllTransactions, 
  getTransactionById, 
  createTransaction, 
  updateTransaction, 
  deleteTransaction,
  getTransactionStats
} from '../controllers/transactionController';
import { authenticateJWT } from '../middleware/authMiddleware';
import { isolatedHandler } from '../utils/asyncHandler';

const router = express.Router();

// Apply JWT authentication to all transaction routes
router.use(authenticateJWT);

/**
 * @route   GET /api/transactions
 * @desc    Get all transactions
 * @access  Private
 */
router.get('/', isolatedHandler(getAllTransactions, { transactions: [] }));

/**
 * @route   GET /api/transactions/stats
 * @desc    Get transaction statistics
 * @access  Private
 */
router.get('/stats', isolatedHandler(getTransactionStats, { stats: {} }));

/**
 * @route   GET /api/transactions/:id
 * @desc    Get transaction by ID
 * @access  Private
 */
router.get('/:id', isolatedHandler(getTransactionById, { transaction: null }));

/**
 * @route   POST /api/transactions
 * @desc    Create a new transaction
 * @access  Private
 */
router.post('/', isolatedHandler(createTransaction));

/**
 * @route   PUT /api/transactions/:id
 * @desc    Update a transaction
 * @access  Private
 */
router.put('/:id', isolatedHandler(updateTransaction));

/**
 * @route   DELETE /api/transactions/:id
 * @desc    Delete a transaction
 * @access  Private
 */
router.delete('/:id', isolatedHandler(deleteTransaction));

export default router; 