import { Router } from 'express';
import * as expenseController from '../controllers/expenseController';
import { auth } from '../middleware/authMiddleware';

const router = Router();

/**
 * @route   GET /api/expenses
 * @desc    Get all expenses
 * @access  Private
 */
router.get('/', auth, expenseController.getExpenses);

/**
 * @route   GET /api/expenses/:id
 * @desc    Get expense by ID
 * @access  Private
 */
router.get('/:id', auth, expenseController.getExpenseById);

/**
 * @route   POST /api/expenses
 * @desc    Create a new expense
 * @access  Private
 */
router.post('/', auth, expenseController.createExpense);

/**
 * @route   PUT /api/expenses/:id
 * @desc    Update an expense
 * @access  Private
 */
router.put('/:id', auth, expenseController.updateExpense);

/**
 * @route   DELETE /api/expenses/:id
 * @desc    Delete an expense
 * @access  Private
 */
router.delete('/:id', auth, expenseController.deleteExpense);

export default router; 