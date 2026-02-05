import { Router } from 'express';
import * as cfoosController from '../controllers/cfoosController';
import { chatRateLimiter } from '../middleware/rateLimitMiddleware';

const router = Router();

/**
 * @route   POST /api/cfoos/chat
 * @desc    Chat with the AI CFO for the CFOOS demo dashboard
 * @access  Public (demo only)
 */
router.post('/chat', chatRateLimiter, cfoosController.chat);

export default router;
