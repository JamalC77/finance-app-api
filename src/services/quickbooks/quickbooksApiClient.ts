import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { quickbooksAuthService } from './quickbooksAuthService';
import { ApiError } from '../../utils/errors';
import { env } from '../../utils/env';

/**
 * Client for interacting with the QuickBooks API
 * Handles API request formatting, rate limiting, and error handling
 */
export class QuickbooksApiClient {
  private baseUrl: string;

  constructor() {
    // Use the environment helper to get the API base URL
    this.baseUrl = env.QUICKBOOKS.API_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com/v3';
  }

  /**
   * Get a configured axios instance for making API requests
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Configured axios instance
   */
  private async getApiInstance(organizationId: string, realmId: string): Promise<AxiosInstance> {
    // Get a valid access token
    const accessToken = await quickbooksAuthService.getAccessToken(organizationId);

    // Create and configure axios instance
    const instance = axios.create({
      baseURL: `${this.baseUrl}/company/${realmId}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    // Add response interceptor to handle common errors
    instance.interceptors.response.use(
      response => response,
      async error => {
        if (error.response) {
          // Handle 401 Unauthorized errors (token expired)
          if (error.response.status === 401) {
            try {
              // Refresh token and retry the request
              await quickbooksAuthService.refreshAccessToken(organizationId);
              const newToken = await quickbooksAuthService.getAccessToken(organizationId);
              
              // Update authorization header and retry
              error.config.headers['Authorization'] = `Bearer ${newToken}`;
              return axios(error.config);
            } catch (refreshError) {
              throw new ApiError(401, 'QuickBooks authorization failed');
            }
          }

          // Handle rate limiting (429 Too Many Requests)
          if (error.response.status === 429) {
            // Implementation could add retry logic with exponential backoff
            throw new ApiError(429, 'QuickBooks API rate limit exceeded');
          }
        }

        // Rethrow other errors
        throw error;
      }
    );

    return instance;
  }

  /**
   * Make a GET request to the QuickBooks API
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param endpoint The API endpoint
   * @param params Query parameters
   * @returns API response data
   */
  async get(organizationId: string, realmId: string, endpoint: string, params: any = {}): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);
      const response = await api.get(endpoint, { params });
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'GET', endpoint);
    }
  }

  /**
   * Make a POST request to the QuickBooks API
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param endpoint The API endpoint
   * @param data Request body data
   * @param config Additional axios config
   * @returns API response data
   */
  async post(organizationId: string, realmId: string, endpoint: string, data: any, config?: AxiosRequestConfig): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);
      const response = await api.post(endpoint, data, config);
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'POST', endpoint);
    }
  }

  /**
   * Make a PUT request to the QuickBooks API
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param endpoint The API endpoint
   * @param data Request body data
   * @returns API response data
   */
  async put(organizationId: string, realmId: string, endpoint: string, data: any): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);
      const response = await api.put(endpoint, data);
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'PUT', endpoint);
    }
  }

  /**
   * Make a DELETE request to the QuickBooks API
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param endpoint The API endpoint
   * @returns API response data
   */
  async delete(organizationId: string, realmId: string, endpoint: string): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);
      const response = await api.delete(endpoint);
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'DELETE', endpoint);
    }
  }

  /**
   * Execute a query using QuickBooks Query Language
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param query The QuickBooks query
   * @returns Query results
   */
  async query(organizationId: string, realmId: string, query: string): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);
      const encodedQuery = encodeURIComponent(query);
      const response = await api.get(`/query?query=${encodedQuery}`);
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'QUERY', query);
    }
  }

  /**
   * Standard error handler for API requests
   * 
   * @param error The caught error
   * @param method The HTTP method
   * @param endpoint The API endpoint
   */
  private handleApiError(error: any, method: string, endpoint: string): never {
    console.error(`QuickBooks API ${method} ${endpoint} error:`, error);
    
    if (error.response) {
      // The request was made and the server responded with a non-2xx status
      const statusCode = error.response.status;
      const responseData = error.response.data;
      
      let message = `QuickBooks API error (${statusCode})`;
      
      if (responseData && responseData.Fault && responseData.Fault.Error && responseData.Fault.Error[0]) {
        message = `${message}: ${responseData.Fault.Error[0].Message} (${responseData.Fault.Error[0].code})`;
      }
      
      throw new ApiError(statusCode, message);
    } else if (error.request) {
      // The request was made but no response was received
      throw new ApiError(503, 'No response from QuickBooks API');
    } else {
      // Something happened in setting up the request
      throw new ApiError(500, `Error making QuickBooks API request: ${error.message}`);
    }
  }
}

// Export singleton instance
export const quickbooksApiClient = new QuickbooksApiClient(); 