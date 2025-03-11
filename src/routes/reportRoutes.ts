import { Router } from 'express';
import * as reportController from '../controllers/reportController';
import { auth } from '../middleware/authMiddleware';

const router = Router();

/**
 * @route   GET /api/reports/profit-loss
 * @desc    Generate a profit and loss report
 * @access  Private
 */
router.get('/profit-loss', auth, reportController.getProfitLossReport);

/**
 * @route   GET /api/reports/balance-sheet
 * @desc    Generate a balance sheet report
 * @access  Private
 */
router.get('/balance-sheet', auth, reportController.getBalanceSheetReport);

/**
 * @route   GET /api/reports/cash-flow
 * @desc    Generate a cash flow report
 * @access  Private
 */
router.get('/cash-flow', auth, reportController.getCashFlowReport);

/**
 * @route   GET /api/reports/accounts-receivable
 * @desc    Generate an accounts receivable aging report
 * @access  Private
 */
router.get('/accounts-receivable', auth, reportController.getAccountsReceivableReport);

/**
 * @route   GET /api/reports/accounts-payable
 * @desc    Generate an accounts payable aging report
 * @access  Private
 */
router.get('/accounts-payable', auth, reportController.getAccountsPayableReport);

/**
 * @route   GET /api/reports/tax-summary
 * @desc    Generate a tax summary report
 * @access  Private
 */
router.get('/tax-summary', auth, reportController.getTaxSummaryReport);

/**
 * @route   GET /api/reports/custom
 * @desc    Generate a custom report based on user parameters
 * @access  Private
 */
router.get('/custom', auth, reportController.getCustomReport);

/**
 * @route   POST /api/reports/export
 * @desc    Export a report to CSV, Excel, or PDF
 * @access  Private
 */
router.post('/export', auth, reportController.exportReport);

export default router; 