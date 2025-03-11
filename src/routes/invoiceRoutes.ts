import { Router } from 'express';
import * as invoiceController from '../controllers/invoiceController';
import { auth } from '../middleware/authMiddleware';

const router = Router();

/**
 * @route   GET /api/invoices
 * @desc    Get all invoices
 * @access  Private
 */
router.get('/', auth, invoiceController.getInvoices);

/**
 * @route   GET /api/invoices/:id
 * @desc    Get invoice by ID
 * @access  Private
 */
router.get('/:id', auth, invoiceController.getInvoiceById);

/**
 * @route   POST /api/invoices
 * @desc    Create a new invoice
 * @access  Private
 */
router.post('/', auth, invoiceController.createInvoice);

/**
 * @route   PUT /api/invoices/:id
 * @desc    Update an invoice
 * @access  Private
 */
router.put('/:id', auth, invoiceController.updateInvoice);

/**
 * @route   DELETE /api/invoices/:id
 * @desc    Delete an invoice
 * @access  Private
 */
router.delete('/:id', auth, invoiceController.deleteInvoice);

export default router; 