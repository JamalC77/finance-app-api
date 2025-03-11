import express from 'express';

const router = express.Router();

/**
 * Simple test route
 */
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Insights routes are working',
    timestamp: new Date().toISOString()
  });
});

export default router; 