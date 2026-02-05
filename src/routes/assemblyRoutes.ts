import { Router } from 'express';
import * as assemblyController from '../controllers/assemblyController';
import { chatRateLimiter } from '../middleware/rateLimitMiddleware';

const router = Router();

/**
 * @route   POST /api/assembly/generate
 * @desc    Generate a dynamic dashboard assembly config via Claude
 * @access  Public (demo data only)
 */
router.post('/generate', chatRateLimiter, assemblyController.generateAssembly);

/**
 * @route   POST /api/assembly/warmup
 * @desc    Pre-generate and cache the AI assembly config
 * @access  Public (demo data only)
 */
router.post('/warmup', chatRateLimiter, assemblyController.warmup);

export default router;
