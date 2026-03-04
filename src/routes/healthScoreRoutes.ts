import express from 'express';
import { healthScoreController } from '../controllers/healthScoreController';

const router = express.Router();

// POST /api/public/health-score/start
// Create prospect + return QB OAuth URL
router.post('/start', (req, res) => healthScoreController.start(req, res));

// GET /api/public/health-score/:id/status
// Poll processing status (frontend polls every 3s)
router.get('/:id/status', (req, res) => healthScoreController.status(req, res));

// GET /api/public/health-score/:id/result
// Final score data (only if COMPLETED)
router.get('/:id/result', (req, res) => healthScoreController.result(req, res));

export default router;
