import { Request, Response } from 'express';
import { accountService } from '../services/accountService';
import { AccountType } from '@prisma/client';

/**
 * Get all accounts for the organization
 */
export const getAllAccounts = async (req: Request, res: Response) => {
  try {
    // Get the organization ID from the authenticated user
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ message: 'Organization ID is required' });
    }
    
    // Parse query parameters
    const type = req.query.type as AccountType | undefined;
    const isActive = req.query.isActive === 'true' ? true : 
                    req.query.isActive === 'false' ? false : undefined;
    
    // Get accounts from the database
    const accounts = await accountService.findAll(organizationId, { type, isActive });
    
    return res.status(200).json(accounts);
  } catch (error) {
    console.error('Error getting accounts:', error);
    return res.status(500).json({ message: 'Failed to get accounts', error: (error as Error).message });
  }
};

/**
 * Get a specific account by ID
 */
export const getAccountById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ message: 'Organization ID is required' });
    }
    
    const account = await accountService.findById(id, organizationId);
    
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }
    
    return res.status(200).json(account);
  } catch (error) {
    console.error('Error getting account:', error);
    return res.status(500).json({ message: 'Failed to get account', error: (error as Error).message });
  }
};

/**
 * Create a new account
 */
export const createAccount = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ message: 'Organization ID is required' });
    }
    
    // Create account in the database
    const newAccount = await accountService.create(req.body, organizationId);
    
    return res.status(201).json(newAccount);
  } catch (error) {
    console.error('Error creating account:', error);
    return res.status(500).json({ message: 'Failed to create account', error: (error as Error).message });
  }
};

/**
 * Update an existing account
 */
export const updateAccount = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ message: 'Organization ID is required' });
    }
    
    // Check if account exists and belongs to the user's organization
    const existingAccount = await accountService.findById(id, organizationId);
    
    if (!existingAccount) {
      return res.status(404).json({ message: 'Account not found' });
    }
    
    // Update account in the database
    const updatedAccount = await accountService.update(id, req.body, organizationId);
    
    return res.status(200).json(updatedAccount);
  } catch (error) {
    console.error('Error updating account:', error);
    return res.status(500).json({ message: 'Failed to update account', error: (error as Error).message });
  }
};

/**
 * Delete an account
 */
export const deleteAccount = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ message: 'Organization ID is required' });
    }
    
    // Check if account exists and belongs to the user's organization
    const existingAccount = await accountService.findById(id, organizationId);
    
    if (!existingAccount) {
      return res.status(404).json({ message: 'Account not found' });
    }
    
    // Delete account from the database
    const deletedAccount = await accountService.delete(id, organizationId);
    
    return res.status(200).json(deletedAccount);
  } catch (error) {
    console.error('Error deleting account:', error);
    return res.status(500).json({ message: 'Failed to delete account', error: (error as Error).message });
  }
};

/**
 * Get account hierarchy for the organization
 */
export const getAccountHierarchy = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ message: 'Organization ID is required' });
    }
    
    const hierarchy = await accountService.getAccountHierarchy(organizationId);
    
    return res.status(200).json(hierarchy);
  } catch (error) {
    console.error('Error getting account hierarchy:', error);
    return res.status(500).json({ message: 'Failed to get account hierarchy', error: (error as Error).message });
  }
};

/**
 * Get balance for a specific account
 */
export const getAccountBalance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ message: 'Organization ID is required' });
    }
    
    const balance = await accountService.getAccountBalance(id, organizationId);
    
    return res.status(200).json({ balance });
  } catch (error) {
    console.error('Error getting account balance:', error);
    return res.status(500).json({ message: 'Failed to get account balance', error: (error as Error).message });
  }
}; 