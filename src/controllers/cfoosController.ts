import { Request, Response } from 'express';
import { cfoosAssemblyChatService } from '../services/cfoosAssemblyChatService';
import { asyncHandler } from '../utils/asyncHandler';

export const chat = asyncHandler(async (req: Request, res: Response) => {
  const { messages, userMessage } = req.body;

  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return res.status(400).json({ error: 'userMessage is required' });
  }

  const trimmedMessage = userMessage.trim().slice(0, 2000);

  const result = await cfoosAssemblyChatService.chat({
    messages: messages || [],
    userMessage: trimmedMessage,
  });

  res.json({ success: true, ...result });
});
