import express from 'express';
import { quickbooksAuthService } from '../services/quickbooks/quickbooksAuthService';
import { quickbooksConnectionController } from '../controllers/quickbooks/quickbooksConnectionController';
import { quickbooksSyncController } from '../controllers/quickbooks/quickbooksSyncController';
import { authMiddleware } from '../middleware/authMiddleware';
import { formatErrorResponse } from '../utils/errors';
import { quickbooksToSnowflakeController } from '../controllers/quickbooks/quickbooksToSnowflakeController';

const router = express.Router();

/**
 * Authentication routes
 */

// Generate authorization URL
router.get('/auth/url', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const authUrl = quickbooksAuthService.getAuthorizationUrl(organizationId);
    res.json({ success: true, data: { url: authUrl } });
  } catch (error) {
    console.error('Error generating QuickBooks auth URL:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

// Handle OAuth callback
router.get('/callback', async (req, res) => {
  try {
    console.log('QuickBooks callback received:');
    console.log('- Full URL:', req.protocol + '://' + req.get('host') + req.originalUrl);
    console.log('- Query params:', req.query);
    
    const { code, state, realmId } = req.query as { code: string, state: string, realmId: string };
    
    if (!code || !state || !realmId) {
      console.error('Missing required parameters in callback');
      return res.status(400).json(formatErrorResponse({ 
        statusCode: 400, 
        message: 'Missing required parameters' 
      }));
    }
    
    const organizationId = await quickbooksAuthService.handleCallback(code, state, realmId);
    
    // Redirect to frontend with success
    const redirectUrl = `${process.env.FRONTEND_URL}/settings/integrations/quickbooks/success?organizationId=${organizationId}`;
    console.log('Redirecting to:', redirectUrl);
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Error handling QuickBooks callback:', error);
    // Redirect to frontend with error
    res.redirect(`${process.env.FRONTEND_URL}/settings/integrations/quickbooks/error`);
  }
});

/**
 * Connection management routes
 */

// Get connection status
router.get('/connection', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const connection = await quickbooksConnectionController.getConnection(organizationId);
    
    // Log the connection response for debugging
    console.log('QuickBooks connection response:', JSON.stringify(connection));
    
    // Wrap the connection in a data property as expected by the frontend
    res.json({ data: connection });
  } catch (error) {
    console.error('Error getting QuickBooks connection:', error);
    // Return a structured error response
    res.status(500).json({
      data: { connected: false },
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update connection settings
router.put('/connection/settings', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const { syncFrequency, syncSettings } = req.body;
    
    const updatedConnection = await quickbooksConnectionController.updateSettings(
      organizationId,
      syncFrequency,
      syncSettings
    );
    
    res.json(updatedConnection);
  } catch (error) {
    console.error('Error updating QuickBooks connection settings:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

// Disconnect from QuickBooks
router.delete('/connection', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    await quickbooksConnectionController.disconnect(organizationId);
    res.json({ success: true, message: 'Successfully disconnected from QuickBooks' });
  } catch (error) {
    console.error('Error disconnecting from QuickBooks:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

/**
 * Data synchronization routes
 */

// Get sync status
router.get('/sync/status', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const status = await quickbooksSyncController.getSyncStatus(organizationId);
    res.json(status);
  } catch (error) {
    console.error('Error getting QuickBooks sync status:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

// Start a full sync
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    // Start the sync process asynchronously
    quickbooksSyncController.startFullSync(organizationId)
      .catch(error => console.error('Async sync error:', error));
    
    res.json({ success: true, message: 'Sync started' });
  } catch (error) {
    console.error('Error starting QuickBooks sync:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

// Sync a specific entity
router.post('/sync/:entityType', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const { entityType } = req.params;
    
    // Start the entity sync process asynchronously
    quickbooksSyncController.syncEntity(organizationId, entityType)
      .catch(error => console.error(`Async ${entityType} sync error:`, error));
    
    res.json({ success: true, message: `${entityType} sync started` });
  } catch (error) {
    console.error('Error starting QuickBooks entity sync:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

// Get sync history
router.get('/sync/history', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    
    const history = await quickbooksSyncController.getSyncHistory(organizationId, limit);
    res.json(history);
  } catch (error) {
    console.error('Error getting QuickBooks sync history:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

/**
 * Direct QuickBooks to Snowflake export routes
 */

// Start a direct export of all data from QuickBooks to Snowflake
router.post('/direct-export', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    // Start the direct export process asynchronously
    quickbooksToSnowflakeController.startDirectExport(organizationId)
      .catch(error => console.error('Async direct export error:', error));
    
    res.json({ success: true, message: 'Direct export started' });
  } catch (error) {
    console.error('Error starting direct QuickBooks to Snowflake export:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

// Export a specific entity type directly from QuickBooks to Snowflake
router.post('/direct-export/:entityType', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const { entityType } = req.params;
    
    if (!['accounts', 'transactions', 'invoices', 'contacts'].includes(entityType)) {
      return res.status(400).json(formatErrorResponse({
        statusCode: 400,
        message: 'Invalid entity type. Must be one of: accounts, transactions, invoices, contacts'
      }));
    }
    
    // Start the entity direct export process asynchronously
    quickbooksToSnowflakeController.exportEntityDirectly(organizationId, entityType)
      .catch(error => console.error(`Async direct ${entityType} export error:`, error));
    
    res.json({ success: true, message: `Direct ${entityType} export started` });
  } catch (error) {
    console.error('Error starting direct QuickBooks entity export:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

// Get direct export status
router.get('/direct-export/status', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const status = await quickbooksToSnowflakeController.getDirectExportStatus(organizationId);
    res.json(status);
  } catch (error) {
    console.error('Error getting direct export status:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

// Get direct export history
router.get('/direct-export/history', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    
    const history = await quickbooksToSnowflakeController.getDirectExportHistory(organizationId, limit);
    res.json(history);
  } catch (error) {
    console.error('Error getting direct export history:', error);
    res.status(500).json(formatErrorResponse(error));
  }
});

export default router; 