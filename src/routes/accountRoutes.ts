import express from 'express';
import { auth } from '../middleware/authMiddleware';
import {
  getAllAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  getAccountHierarchy,
  getAccountBalance
} from '../controllers/accountController';

const router = express.Router();

// Apply authentication middleware to all account routes
router.use(auth);

// Get all accounts
router.get('/', getAllAccounts);

// Get account hierarchy
router.get('/hierarchy', getAccountHierarchy);

// Get a specific account
router.get('/:id', getAccountById);

// Get account balance
router.get('/:id/balance', getAccountBalance);

// Create a new account
router.post('/', createAccount);

// Update an account
router.put('/:id', updateAccount);

// Delete an account
router.delete('/:id', deleteAccount);

export default router; 