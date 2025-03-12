import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { snowflakeController } from '../controllers/snowflakeController';
import { formatErrorResponse } from '../utils/errors';

const router = express.Router();

// All Snowflake routes require authentication
router.use(authMiddleware);

/**
 * Initialize Snowflake for the current organization
 */
router.post('/initialize', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    await snowflakeController.initializeForOrganization(organizationId);
    
    res.json({ success: true, message: 'Snowflake initialized successfully' });
  } catch (error) {
    console.error('Error initializing Snowflake:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Export all data to Snowflake
 */
router.post('/export', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    // Create an export log entry with IN_PROGRESS status
    await snowflakeController.createExportLog(organizationId, 'IN_PROGRESS');
    
    // Start the export process asynchronously
    snowflakeController.exportAllData(organizationId)
      .then(counts => {
        // Update the export log with success status
        snowflakeController.createExportLog(organizationId, 'COMPLETED', counts);
      })
      .catch(error => {
        // Update the export log with error status
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        snowflakeController.createExportLog(organizationId, 'FAILED', undefined, errorMessage);
        console.error('Async export error:', error);
      });
    
    res.json({ success: true, message: 'Export started' });
  } catch (error) {
    console.error('Error starting Snowflake export:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Get export status
 */
router.get('/status', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const status = await snowflakeController.getExportStatus(organizationId);
    
    res.json(status);
  } catch (error) {
    console.error('Error getting Snowflake export status:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

export default router; 