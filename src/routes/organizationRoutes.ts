import express from 'express';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

// Apply authentication middleware to all organization routes
router.use(authenticateJWT);

// GET /api/organizations - Get all organizations the user has access to
router.get('/', (req, res) => {
  res.status(200).json({ message: 'Get all organizations' });
});

// GET /api/organizations/:id - Get a specific organization
router.get('/:id', (req, res) => {
  res.status(200).json({ message: `Get organization with ID: ${req.params.id}` });
});

// POST /api/organizations - Create a new organization
router.post('/', (req, res) => {
  res.status(201).json({ message: 'Create a new organization' });
});

// PUT /api/organizations/:id - Update an organization
router.put('/:id', (req, res) => {
  res.status(200).json({ message: `Update organization with ID: ${req.params.id}` });
});

// DELETE /api/organizations/:id - Delete an organization
router.delete('/:id', (req, res) => {
  res.status(200).json({ message: `Delete organization with ID: ${req.params.id}` });
});

export default router; 