import { Request, Response } from 'express';
import { assemblyEngineService } from '../services/assemblyEngineService';
import { asyncHandler } from '../utils/asyncHandler';

export const generateAssembly = asyncHandler(async (req: Request, res: Response) => {
  const { clientId, industry } = req.body;

  const { config, source } = await assemblyEngineService.generateAssemblyConfig(
    clientId || 'summit-ridge-demo',
    industry || 'residential_construction'
  );

  res.json({ success: true, data: config, source });
});

export const warmup = asyncHandler(async (req: Request, res: Response) => {
  const { clientId, industry } = req.body;

  const result = await assemblyEngineService.warmup(
    clientId || 'summit-ridge-demo',
    industry || 'residential_construction'
  );

  res.json({ success: true, ...result });
});
