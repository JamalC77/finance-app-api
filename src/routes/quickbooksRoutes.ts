import express from 'express';

const router = express.Router();

/**
 * Test routes - no authentication required
 */
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'QuickBooks routes are working',
    timestamp: new Date().toISOString()
  });
});

/**
 * Authentication routes
 */

// Simple auth URL endpoint that doesn't depend on other services
router.get('/auth/url', (req, res) => {
  try {
    // Hardcoded example URL for testing
    const authUrl = 'https://appcenter.intuit.com/connect/oauth2?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:5000/api/quickbooks/callback&response_type=code&scope=com.intuit.quickbooks.accounting&state=example_state';
    
    res.json({ 
      success: true, 
      data: { 
        url: authUrl,
        note: "This is a test URL. In production, this would be dynamically generated."
      } 
    });
  } catch (error: any) {
    console.error('Error generating QuickBooks auth URL:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to generate authorization URL',
      message: error.message || 'Unknown error'
    });
  }
});

export default router; 