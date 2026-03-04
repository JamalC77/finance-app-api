import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Ensure env vars are loaded
if (!process.env.VERCEL) {
  const result = dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
  }
}

// Lazy initialization of Anthropic client (singleton)
let anthropicClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    let apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      try {
        const envPath = path.resolve(process.cwd(), '.env');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/^ANTHROPIC_API_KEY=(.+)$/m);
        if (match) {
          apiKey = match[1].trim();
          process.env.ANTHROPIC_API_KEY = apiKey;
        }
      } catch (e) {
        console.error('Failed to read .env file:', e);
      }
    }

    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set in environment variables');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}
