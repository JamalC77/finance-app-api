import { Router } from 'express';
import * as contactController from '../controllers/contactController';
import { auth } from '../middleware/authMiddleware';

const router = Router();

/**
 * @route   GET /api/contacts
 * @desc    Get all contacts
 * @access  Private
 */
router.get('/', auth, contactController.getContacts);

/**
 * @route   GET /api/contacts/:id
 * @desc    Get contact by ID
 * @access  Private
 */
router.get('/:id', auth, contactController.getContactById);

/**
 * @route   POST /api/contacts
 * @desc    Create a new contact
 * @access  Private
 */
router.post('/', auth, contactController.createContact);

/**
 * @route   PUT /api/contacts/:id
 * @desc    Update a contact
 * @access  Private
 */
router.put('/:id', auth, contactController.updateContact);

/**
 * @route   DELETE /api/contacts/:id
 * @desc    Delete a contact
 * @access  Private
 */
router.delete('/:id', auth, contactController.deleteContact);

export default router; 