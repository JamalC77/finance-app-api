import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file in non-Vercel environments
if (!process.env.VERCEL) {
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
}

/**
 * Function to get environment variables with validation
 */
export function getEnvVariable(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;

  if (value === undefined) {
    throw new Error(`Environment variable ${key} is not set`);
  }

  return value;
}

/**
 * Function to get optional environment variables (won't throw if missing)
 */
export function getOptionalEnvVariable(key: string, defaultValue: string = ""): string {
  return process.env[key] || defaultValue;
}

// Get Vercel URL if available (for serverless deployment)
const getServerUrl = (): string => {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://localhost:${process.env.PORT || 5000}`;
};

/**
 * Export commonly used environment variables
 */
export const env = {
  // Server
  PORT: parseInt(getEnvVariable("PORT", "5000"), 10),
  NODE_ENV: getEnvVariable("NODE_ENV", "development"),
  SERVER_URL: getServerUrl(),

  // Database
  DATABASE_URL: getEnvVariable("DATABASE_URL"),

  // CORS
  FRONTEND_URL: getEnvVariable("FRONTEND_URL", "http://localhost:3000"),

  // Authentication
  JWT_SECRET: getEnvVariable("JWT_SECRET"),
  JWT_EXPIRATION: getEnvVariable("JWT_EXPIRATION", "7d"),

  // Plaid
  PLAID: {
    CLIENT_ID: getEnvVariable("PLAID_CLIENT_ID"),
    SECRET: getEnvVariable("PLAID_SECRET"),
    ENV: getEnvVariable("PLAID_ENV", "sandbox"),
  },

  // Stripe
  STRIPE: {
    SECRET_KEY: getEnvVariable("STRIPE_SECRET_KEY"),
    WEBHOOK_SECRET: getEnvVariable("STRIPE_WEBHOOK_SECRET"),
  },

  // QuickBooks (optional)
  QUICKBOOKS: {
    CLIENT_ID: getOptionalEnvVariable("QUICKBOOKS_CLIENT_ID"),
    CLIENT_SECRET: getOptionalEnvVariable("QUICKBOOKS_CLIENT_SECRET"),
    REDIRECT_URI: getOptionalEnvVariable("QUICKBOOKS_REDIRECT_URI"),
    ENVIRONMENT: getOptionalEnvVariable("QUICKBOOKS_ENVIRONMENT", "sandbox"),
    API_BASE_URL: getOptionalEnvVariable("QUICKBOOKS_API_BASE_URL", "https://sandbox-quickbooks.api.intuit.com/v3"),
  },

  // Encryption (optional)
  ENCRYPTION: {
    KEY: getOptionalEnvVariable("ENCRYPTION_KEY", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"),
    IV: getOptionalEnvVariable("ENCRYPTION_IV", "a1b2c3d4e5f6g7h8"),
  },

  // Email services
  RESEND_API_KEY: getOptionalEnvVariable("RESEND_API_KEY"),
  EMAIL_FROM: getOptionalEnvVariable("EMAIL_FROM", "Finance App <noreply@example.com>"),

  // Vercel-specific
  IS_VERCEL: !!process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV || "development",
};

// Check if we're in a development environment
export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";
export const isVercel = env.IS_VERCEL;
