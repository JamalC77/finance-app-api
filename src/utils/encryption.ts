import crypto from 'crypto';
import { env } from './env';

/**
 * Utility class for encrypting/decrypting sensitive data
 */
export class EncryptionUtil {
  private key: Buffer;
  private iv: Buffer;
  private algorithm: string = 'aes-256-cbc';

  constructor() {
    // Get encryption key and IV from environment variables
    const envKey = env.ENCRYPTION.KEY;
    const envIv = env.ENCRYPTION.IV;

    // We're now using default values in env.ts, so we don't need to throw here
    this.key = Buffer.from(envKey, 'utf-8');
    this.iv = Buffer.from(envIv, 'utf-8');
  }

  /**
   * Encrypts a string value
   * @param text The plaintext value to encrypt
   * @returns The encrypted value as a base64 string
   */
  encrypt(text: string): string {
    const cipher = crypto.createCipheriv(this.algorithm, this.key, this.iv);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  /**
   * Decrypts a previously encrypted string
   * @param encryptedText The encrypted text (base64)
   * @returns The decrypted plaintext
   */
  decrypt(encryptedText: string): string {
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, this.iv);
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Creates a secure, encrypted state for OAuth flows
   * @param data Any data to store in the state
   * @returns Encrypted state string
   */
  encryptState(data: string): string {
    const stateObj = {
      data,
      timestamp: Date.now(),
    };
    return this.encrypt(JSON.stringify(stateObj));
  }

  /**
   * Decrypts and validates a state parameter from OAuth flow
   * @param state The encrypted state
   * @param maxAgeMs Maximum age of the state in milliseconds
   * @returns The decrypted data
   */
  decryptState(state: string, maxAgeMs: number = 3600000): string {
    try {
      const decrypted = this.decrypt(state);
      const stateObj = JSON.parse(decrypted);
      
      // Validate timestamp to prevent replay attacks
      if (Date.now() - stateObj.timestamp > maxAgeMs) {
        throw new Error('State parameter has expired');
      }
      
      return stateObj.data;
    } catch (error) {
      throw new Error('Invalid state parameter');
    }
  }
}

// Export a singleton instance
export const encryption = new EncryptionUtil(); 