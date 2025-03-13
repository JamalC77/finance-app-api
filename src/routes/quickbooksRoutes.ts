import express from 'express';
import { quickbooksAuthService } from '../services/quickbooks/quickbooksAuthService';
import { quickbooksConnectionController } from '../controllers/quickbooks/quickbooksConnectionController';
import { quickbooksSyncController } from '../controllers/quickbooks/quickbooksSyncController';
import { authMiddleware } from '../middleware/authMiddleware';
import { formatErrorResponse } from '../utils/errors';
import { quickbooksToSnowflakeController } from '../controllers/quickbooks/quickbooksToSnowflakeController';
import { quickbooksDashboardController } from '../controllers/quickbooks/quickbooksDashboardController';
import { quickbooksApiClient } from '../services/quickbooks/quickbooksApiClient';
import { Request, Response } from 'express';
import { ApiError } from '../utils/errors';

// Interface for JWT payload from auth middleware
interface JwtPayload {
  id: string;
  email: string;
  organizationId: string;
  role: string;
}

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

/**
 * Dashboard data routes
 */
 
// Get dashboard data from QuickBooks
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    console.log('📊 [QB ROUTE] Dashboard data request received');
    
    if (!req.user) {
      console.log('❌ [QB ROUTE] User not authenticated');
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    console.log(`🔍 [QB ROUTE] Processing dashboard request for organization: ${organizationId}`);
    
    // Check if QuickBooks is connected
    try {
      const connection = await quickbooksConnectionController.getConnection(organizationId);
      console.log(`📡 [QB ROUTE] Connection status: ${connection.connected ? 'Connected' : 'Not connected'}, Details:`, JSON.stringify(connection));
      
      if (!connection.connected) {
        console.log('❌ [QB ROUTE] No active QuickBooks connection');
        return res.status(400).json(formatErrorResponse({
          statusCode: 400,
          message: 'No active QuickBooks connection'
        }));
      }
      
      try {
        // Get dashboard data from QuickBooks
        console.log('🔄 [QB ROUTE] Fetching dashboard data from QuickBooks');
        const dashboardData = await quickbooksDashboardController.getDashboardData(organizationId);
        console.log('✅ [QB ROUTE] Dashboard data fetched successfully');
        
        res.json({ success: true, data: dashboardData });
      } catch (dashboardError) {
        console.error('❌ [QB ROUTE] Error in quickbooksDashboardController.getDashboardData:', dashboardError);
        if (dashboardError instanceof Error) {
          console.error('Error message:', dashboardError.message);
          console.error('Error stack:', dashboardError.stack);
        }
        throw dashboardError; // Re-throw to be caught by outer catch
      }
    } catch (connectionError) {
      console.error('❌ [QB ROUTE] Error in quickbooksConnectionController.getConnection:', connectionError);
      if (connectionError instanceof Error) {
        console.error('Error message:', connectionError.message);
        console.error('Error stack:', connectionError.stack);
      }
      throw connectionError; // Re-throw to be caught by outer catch
    }
  } catch (error) {
    console.error('❌ [QB ROUTE] Error getting QuickBooks dashboard data:', error);
    // Add more detailed error logging
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      // If it's an API error, log additional details
      if ('statusCode' in error) {
        console.error('Error status code:', (error as any).statusCode);
      }
    }
    
    // Return a more helpful error response
    res.status(500).json(formatErrorResponse({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Unknown error in QuickBooks dashboard',
      details: process.env.NODE_ENV !== 'production' ? (error instanceof Error ? error.stack : String(error)) : undefined
    }));
  }
});

/**
 * Test routes
 */
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'QuickBooks routes are working!',
    datetime: new Date().toISOString()
  });
});

// Add a new test route for checking authentication
router.get('/test-auth', authMiddleware, async (req, res) => {
  try {
    console.log('📋 [QB TEST] Testing QuickBooks authentication');
    
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    console.log(`🔍 [QB TEST] Testing auth for organization: ${organizationId}`);
    
    try {
      // Check connection status
      const connection = await quickbooksConnectionController.getConnection(organizationId);
      console.log(`📡 [QB TEST] Connection status:`, JSON.stringify(connection));
      
      // If connected, try to get a token
      if (connection.connected) {
        try {
          const token = await quickbooksAuthService.getAccessToken(organizationId);
          // Don't log the full token for security reasons
          const tokenPreview = token.substring(0, 10) + '...' + token.substring(token.length - 10);
          console.log(`🔑 [QB TEST] Successfully retrieved token: ${tokenPreview}`);
          
          // Return the test results
          res.json({
            success: true,
            message: 'QuickBooks authentication is working',
            connectionStatus: connection,
            tokenTest: 'Valid token retrieved',
            datetime: new Date().toISOString()
          });
        } catch (tokenError) {
          console.error('❌ [QB TEST] Error getting token:', tokenError);
          res.status(500).json(formatErrorResponse({
            statusCode: 500,
            message: 'Error getting token',
            details: tokenError instanceof Error ? tokenError.message : 'Unknown token error'
          }));
        }
      } else {
        res.json({
          success: true,
          message: 'QuickBooks not connected',
          connectionStatus: connection,
          datetime: new Date().toISOString()
        });
      }
    } catch (connectionError) {
      console.error('❌ [QB TEST] Error checking connection:', connectionError);
      res.status(500).json(formatErrorResponse({
        statusCode: 500,
        message: 'Error checking QuickBooks connection',
        details: connectionError instanceof Error ? connectionError.message : 'Unknown connection error'
      }));
    }
  } catch (error) {
    console.error('❌ [QB TEST] Unexpected error:', error);
    res.status(500).json(formatErrorResponse({
      statusCode: 500,
      message: 'Unexpected error in QuickBooks test',
      details: error instanceof Error ? error.message : 'Unknown error'
    }));
  }
});

// Add a test route for QuickBooks connection with direct query test
router.get('/test-query', authMiddleware, async (req: Request, res: Response) => {
  try {
    // Get user details from the request
    const { id: userId, organizationId } = req.user as JwtPayload;
    console.log(`🧪 [QB ROUTE] Testing QuickBooks query for user ${userId}, organization ${organizationId}`);
    
    // Get connection status
    const connection = await quickbooksConnectionController.getConnection(organizationId);
    
    if (!connection.connected) {
      console.log('❌ [QB ROUTE] No QuickBooks connection for test query');
      return res.status(400).json({ error: 'No QuickBooks connection' });
    }
    
    // Try a simple test query that should always work
    const testQuery = "SELECT * FROM CompanyInfo";
    const result = await quickbooksApiClient.query(organizationId, connection.realmId, testQuery);
    
    return res.json({ 
      success: true, 
      message: 'QuickBooks query test successful',
      data: result.QueryResponse?.CompanyInfo?.[0] || {}
    });
  } catch (error) {
    console.error('❌ [QB ROUTE] Error in test query:', error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error during test query' });
  }
});

export default router; 