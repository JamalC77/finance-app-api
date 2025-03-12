import axios from 'axios';
import querystring from 'querystring';
import { prisma } from '../../utils/prisma';
import { encryption } from '../../utils/encryption';
import { ApiError } from '../../utils/errors';

/**
 * Service for managing QuickBooks OAuth authentication and token lifecycle
 */
export class QuickbooksAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private apiBaseUrl: string;
  private environment: string;

  constructor() {
    // Load configuration from environment variables
    this.clientId = process.env.QUICKBOOKS_CLIENT_ID!;
    this.clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET!;
    this.redirectUri = process.env.QUICKBOOKS_REDIRECT_URI!;
    this.apiBaseUrl = process.env.QUICKBOOKS_API_BASE_URL!;
    this.environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';

    // Validate required configuration
    if (!this.clientId || !this.clientSecret || !this.redirectUri || !this.apiBaseUrl) {
      throw new Error('QuickBooks integration is not properly configured');
    }
  }

  /**
   * Generate the authorization URL for QuickBooks OAuth flow
   * 
   * @param organizationId The organization ID to associate with the QuickBooks connection
   * @returns The authorization URL to redirect the user to
   */
  getAuthorizationUrl(organizationId: string): string {
    const state = encryption.encryptState(organizationId);
    
    // Log the exact redirect URI being used
    console.log('Generating authorization URL with redirect URI:', this.redirectUri);
    
    // Do NOT encode the redirect_uri here - querystring.stringify will handle the encoding
    const params = {
      client_id: this.clientId,
      redirect_uri: this.redirectUri, // Use the raw, unencoded redirect URI
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state
    };

    const baseUrl = this.environment === 'sandbox' 
      ? 'https://appcenter.intuit.com/connect/oauth2'
      : 'https://appcenter.intuit.com/connect/oauth2';
      
    const authUrl = `${baseUrl}?${querystring.stringify(params)}`;
    console.log('Generated authorization URL (partial):', authUrl.substring(0, 100) + '...');
    
    return authUrl;
  }

  /**
   * Handle the callback from QuickBooks OAuth
   * 
   * @param code The authorization code from QuickBooks
   * @param state The state parameter from the callback
   * @param realmId The QuickBooks company ID
   * @returns Promise containing the organization ID
   */
  async handleCallback(code: string, state: string, realmId: string): Promise<string> {
    try {
      console.log('Handling QuickBooks callback with:', { code: code.substring(0, 5) + '...', state: state.substring(0, 5) + '...', realmId });
      
      // Decrypt and validate state parameter
      const organizationId = encryption.decryptState(state);
      console.log('Decrypted organizationId:', organizationId);

      // Ensure the organization exists
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId }
      });

      if (!organization) {
        throw new ApiError(404, 'Organization not found');
      }

      // Exchange authorization code for tokens
      const tokenResponse = await this.getTokensFromCode(code);
      console.log('Received token response');

      // Store connection details in database using upsert
      await prisma.quickbooksConnection.upsert({
        where: { organizationId },
        update: {
          realmId,
          accessToken: encryption.encrypt(tokenResponse.access_token),
          refreshToken: encryption.encrypt(tokenResponse.refresh_token),
          tokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
          isActive: true,
        },
        create: {
          organizationId,
          realmId,
          accessToken: encryption.encrypt(tokenResponse.access_token),
          refreshToken: encryption.encrypt(tokenResponse.refresh_token),
          tokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
          isActive: true,
          syncFrequency: 'DAILY',
        }
      });

      return organizationId;
    } catch (error) {
      console.error('Error handling QuickBooks callback:', error);
      throw new ApiError(500, 'Failed to complete QuickBooks connection');
    }
  }

  /**
   * Exchange authorization code for access and refresh tokens
   * 
   * @param code The authorization code from QuickBooks
   * @returns Promise containing token response
   */
  private async getTokensFromCode(code: string): Promise<any> {
    try {
      const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
      };

      // Important: Do NOT encode the redirect_uri here
      // It must match EXACTLY what was registered in the QuickBooks Developer Portal
      // and what was used in the authorization request
      const data = querystring.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri // Use the raw, unencoded redirect URI
      });

      console.log('Requesting tokens with redirect_uri:', this.redirectUri);
      
      const response = await axios.post(tokenUrl, data, { headers });
      return response.data;
    } catch (error) {
      console.error('Error getting tokens from code:', error);
      if (axios.isAxiosError(error) && error.response) {
        console.error('QuickBooks API error response:', error.response.data);
      }
      throw new ApiError(500, 'Failed to get access tokens from QuickBooks');
    }
  }

  /**
   * Refresh the access token when expired
   * 
   * @param organizationId The organization ID
   * @returns Promise containing the refreshed connection
   */
  async refreshAccessToken(organizationId: string): Promise<any> {
    try {
      // Get current connection
      const connection = await prisma.quickbooksConnection.findUnique({
        where: { organizationId }
      });

      if (!connection) {
        throw new ApiError(404, 'QuickBooks connection not found');
      }

      // Decrypt refresh token
      const refreshToken = encryption.decrypt(connection.refreshToken);

      // Call QuickBooks API to refresh the token
      const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
      };

      const data = querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });

      const response = await axios.post(tokenUrl, data, { headers });

      // Update the tokens in the database
      const updatedConnection = await prisma.quickbooksConnection.update({
        where: { organizationId },
        data: {
          accessToken: encryption.encrypt(response.data.access_token),
          refreshToken: encryption.encrypt(response.data.refresh_token),
          tokenExpiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        }
      });

      return updatedConnection;
    } catch (error) {
      console.error('Error refreshing token:', error);
      
      // If refresh fails, mark connection as inactive
      await prisma.quickbooksConnection.update({
        where: { organizationId },
        data: { isActive: false }
      });
      
      throw new ApiError(401, 'Failed to refresh QuickBooks access token');
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   * 
   * @param organizationId The organization ID
   * @returns Promise containing the access token
   */
  async getAccessToken(organizationId: string): Promise<string> {
    try {
      // Get current connection
      const connection = await prisma.quickbooksConnection.findUnique({
        where: { organizationId }
      });

      if (!connection) {
        throw new ApiError(404, 'QuickBooks connection not found');
      }

      // Check if token is expired (or will expire in the next 5 minutes)
      const isExpired = connection.tokenExpiresAt.getTime() <= Date.now() + 5 * 60 * 1000;

      // If expired, refresh the token
      if (isExpired) {
        await this.refreshAccessToken(organizationId);
        
        // Get updated connection with new token
        const refreshedConnection = await prisma.quickbooksConnection.findUnique({
          where: { organizationId }
        });
        
        if (!refreshedConnection) {
          throw new ApiError(404, 'QuickBooks connection not found after refresh');
        }
        
        return encryption.decrypt(refreshedConnection.accessToken);
      }

      // Return the current token
      return encryption.decrypt(connection.accessToken);
    } catch (error) {
      console.error('Error getting access token:', error);
      throw new ApiError(401, 'Failed to get valid QuickBooks access token');
    }
  }

  /**
   * Disconnect from QuickBooks
   * 
   * @param organizationId The organization ID
   * @returns Promise containing the updated connection
   */
  async disconnect(organizationId: string): Promise<any> {
    try {
      const connection = await prisma.quickbooksConnection.findUnique({
        where: { organizationId }
      });

      if (!connection) {
        throw new ApiError(404, 'QuickBooks connection not found');
      }

      // Revoke tokens at QuickBooks
      try {
        const refreshToken = encryption.decrypt(connection.refreshToken);
        
        // Call QuickBooks revocation endpoint
        const revocationUrl = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
        };
        
        const data = {
          token: refreshToken,
          token_type_hint: 'refresh_token'
        };
        
        await axios.post(revocationUrl, data, { headers });
        console.log(`Successfully revoked QuickBooks tokens for org ${organizationId}`);
      } catch (revocationError) {
        // Log but continue - we'll still mark the connection as inactive
        console.error('Error revoking QuickBooks tokens:', revocationError);
      }

      // Update the connection status
      return prisma.quickbooksConnection.update({
        where: { organizationId },
        data: { isActive: false }
      });
    } catch (error) {
      console.error('Error disconnecting from QuickBooks:', error);
      throw new ApiError(500, 'Failed to disconnect from QuickBooks');
    }
  }
}

// Export singleton instance
export const quickbooksAuthService = new QuickbooksAuthService(); 