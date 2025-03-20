import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { quickbooksAuthService } from "./quickbooksAuthService";
import { ApiError } from "../../utils/errors";

/**
 * Client for interacting with the QuickBooks API
 * Handles API request formatting, rate limiting, and error handling
 */
export class QuickbooksApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.QUICKBOOKS_API_BASE_URL!;

    if (!this.baseUrl) {
      throw new Error("QuickBooks API base URL is not configured");
    }
  }

  /**
   * Get a configured axios instance for making API requests
   *
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Configured axios instance
   */
  private async getApiInstance(
    organizationId: string,
    realmId: string
  ): Promise<AxiosInstance> {
    // Get a valid access token
    const accessToken = await quickbooksAuthService.getAccessToken(
      organizationId
    );

    // Create and configure axios instance
    const instance = axios.create({
      baseURL: `${this.baseUrl}/company/${realmId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    // Add response interceptor to handle common errors
    instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response) {
          // Handle 401 Unauthorized errors (token expired)
          if (error.response.status === 401) {
            try {
              // Refresh token and retry the request
              await quickbooksAuthService.refreshAccessToken(organizationId);
              const newToken = await quickbooksAuthService.getAccessToken(
                organizationId
              );

              // Update authorization header and retry
              error.config.headers["Authorization"] = `Bearer ${newToken}`;
              return axios(error.config);
            } catch (refreshError) {
              throw new ApiError(401, "QuickBooks authorization failed");
            }
          }

          // Handle rate limiting (429 Too Many Requests)
          if (error.response.status === 429) {
            // Implementation could add retry logic with exponential backoff
            throw new ApiError(429, "QuickBooks API rate limit exceeded");
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
  async get(
    organizationId: string,
    realmId: string,
    endpoint: string,
    params: any = {}
  ): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);
      const response = await api.get(endpoint, { params });
      return response.data;
    } catch (error) {
      this.handleApiError(error, "GET", endpoint);
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
  async post(
    organizationId: string,
    realmId: string,
    endpoint: string,
    data: any,
    config?: AxiosRequestConfig
  ): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);
      const response = await api.post(endpoint, data, config);
      return response.data;
    } catch (error) {
      this.handleApiError(error, "POST", endpoint);
    }
  }

  // /**
  //  * Make a PUT request to the QuickBooks API
  //  *
  //  * @param organizationId The organization ID
  //  * @param realmId The QuickBooks company ID
  //  * @param endpoint The API endpoint
  //  * @param data Request body data
  //  * @returns API response data
  //  */
  // async put(organizationId: string, realmId: string, endpoint: string, data: any): Promise<any> {
  //   try {
  //     const api = await this.getApiInstance(organizationId, realmId);
  //     const response = await api.put(endpoint, data);
  //     return response.data;
  //   } catch (error) {
  //     this.handleApiError(error, 'PUT', endpoint);
  //   }
  // }

  // /**
  //  * Make a DELETE request to the QuickBooks API
  //  *
  //  * @param organizationId The organization ID
  //  * @param realmId The QuickBooks company ID
  //  * @param endpoint The API endpoint
  //  * @returns API response data
  //  */
  // async delete(organizationId: string, realmId: string, endpoint: string): Promise<any> {
  //   try {
  //     const api = await this.getApiInstance(organizationId, realmId);
  //     const response = await api.delete(endpoint);
  //     return response.data;
  //   } catch (error) {
  //     this.handleApiError(error, 'DELETE', endpoint);
  //   }
  // }

  /**
   * Execute a query using QuickBooks Query Language
   *
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param query The QuickBooks query
   * @returns Query results
   */
  async query(
    organizationId: string,
    realmId: string,
    query: string
  ): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);

      // According to the QuickBooks API docs:
      // 1. Encode the query as a URL parameter
      const encodedQuery = encodeURIComponent(query);

      // 2. Log the query for debugging
      console.log(`🔍 [QB API] Executing query: ${query}`);

      // 3. Send the query as a GET request with the query parameter
      const response = await api.get(`/query?query=${encodedQuery}`);

      // Log a success message
      console.log(
        `✅ [QB API] Query succeeded, response:`,
        JSON.stringify(response.data.QueryResponse || {}, null, 2).substring(
          0,
          200
        ) + "..."
      );

      return response.data;
    } catch (error) {
      console.log(`❌ [QB API] Query failed: ${query}`);

      if (error.response && error.response.data) {
        console.log(
          `❌ [QB API] Error details:`,
          JSON.stringify(error.response.data, null, 2)
        );
      } else {
        console.log(`❌ [QB API] Error:`, error);
      }

      this.handleApiError(error, "QUERY", query);
    }
  }

  /**
   * Fetch a report from the QuickBooks Reports API
   *
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param reportType The type of report (e.g., 'ProfitAndLoss', 'BalanceSheet')
   * @param params Report parameters (e.g., start_date, end_date, accounting_method)
   * @returns Report data
   */
  async getReport(
    organizationId: string,
    realmId: string,
    reportType: string,
    params: Record<string, string> = {}
  ): Promise<any> {
    try {
      const api = await this.getApiInstance(organizationId, realmId);

      // Build the endpoint URL with parameters
      let endpoint = `/reports/${reportType}`;

      // Add query parameters if provided
      if (Object.keys(params).length > 0) {
        const queryParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          queryParams.append(key, value);
        });
        endpoint += `?${queryParams.toString()}`;
      }

      console.log(
        `🔍 [QB API] Fetching report: ${reportType} with params:`,
        params
      );

      // Send the request
      const response = await api.get(endpoint);

      // Log a success message
      console.log(
        `✅ [QB API] Report fetched successfully:`,
        JSON.stringify(response.data || {}, null, 2).substring(0, 200) + "..."
      );

      return response.data;
    } catch (error) {
      console.log(`❌ [QB API] Report fetch failed: ${reportType}`);

      if (error.response && error.response.data) {
        console.log(
          `❌ [QB API] Error details:`,
          JSON.stringify(error.response.data, null, 2)
        );
      } else {
        console.log(`❌ [QB API] Error:`, error);
      }

      this.handleApiError(error, "REPORT", reportType);
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
      // The request was made and the server responded with an error status
      const statusCode = error.response.status;

      // Extract detailed error information from QuickBooks API response
      let errorMessage = "QuickBooks API error";

      if (error.response.data?.Fault) {
        const fault = error.response.data.Fault;

        if (fault.Error && fault.Error.length > 0) {
          const qbError = fault.Error[0];
          errorMessage = `${qbError.Message || "Unknown error"} (Code: ${
            qbError.code || "Unknown"
          })`;

          // Log detailed error information
          console.error("QB API Error Details:", {
            code: qbError.code,
            message: qbError.Message,
            detail: qbError.Detail,
            element: qbError.element,
          });
        } else {
          errorMessage = `${fault.type || "Unknown fault"}: ${
            fault.message || "Unknown message"
          }`;
        }
      }

      throw new ApiError(statusCode, errorMessage);
    } else if (error.request) {
      // The request was made but no response was received
      console.error("No response received from QuickBooks API:", error.request);
      throw new ApiError(503, "No response from QuickBooks API");
    } else {
      // Something happened in setting up the request
      console.error("Error setting up QuickBooks API request:", error.message);
      throw new ApiError(500, `QuickBooks API setup error: ${error.message}`);
    }
  }
}

// Export singleton instance
export const quickbooksApiClient = new QuickbooksApiClient();
