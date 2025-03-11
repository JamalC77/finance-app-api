import express from 'express';
import { 
  getAllCategories, 
  getCategoryById, 
  createCategory, 
  updateCategory, 
  deleteCategory,
  getCategoryHierarchy
} from '../controllers/categoryController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

// Apply JWT authentication to all category routes
router.use(authenticateJWT);

// Get all categories
router.get('/', getAllCategories);

// Get category hierarchy
router.get('/hierarchy', getCategoryHierarchy);

// Get a specific category by ID
router.get('/:id', getCategoryById);

// Create a new category
router.post('/', createCategory);

// Update an existing category
router.put('/:id', updateCategory);

// Delete a category
router.delete('/:id', deleteCategory);

export default router; 