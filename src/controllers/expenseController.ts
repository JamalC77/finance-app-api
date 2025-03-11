import { Request, Response } from 'express';
import { prisma } from '../models/prisma';
import { Prisma } from '@prisma/client';

/**
 * Get all expenses for the current user's organization
 * @route GET /api/expenses
 */
export const getExpenses = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { startDate, endDate, contactId, status } = req.query;
    
    // Build query filters
    const filters: Prisma.ExpenseWhereInput = {
      organizationId: req.user.organizationId,
      ...(startDate && endDate && {
        date: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string)
        }
      }),
      ...(contactId && { contactId: contactId as string }),
      ...(status && { status: status as any })
    };

    // Get expenses with related data
    const expenses = await prisma.expense.findMany({
      where: filters,
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });

    return res.status(200).json(expenses);
  } catch (error) {
    console.error('Error getting expenses:', error);
    return res.status(500).json({ error: 'Server error while fetching expenses' });
  }
};

/**
 * Get an expense by ID
 * @route GET /api/expenses/:id
 */
export const getExpenseById = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;

    const expense = await prisma.expense.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      },
      include: {
        contact: true,
        transactions: true
      }
    });

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    return res.status(200).json(expense);
  } catch (error) {
    console.error('Error getting expense:', error);
    return res.status(500).json({ error: 'Server error while fetching expense' });
  }
};

/**
 * Create a new expense
 * @route POST /api/expenses
 */
export const createExpense = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { description, date, amount, contactId, reference, accountId, receiptUrl, category } = req.body;

    // Basic validation
    if (!description || !date || !amount) {
      return res.status(400).json({ error: 'Missing required expense data' });
    }

    // Validate contact belongs to organization if contactId is provided
    if (contactId) {
      const contact = await prisma.contact.findFirst({
        where: {
          id: contactId,
          organizationId: req.user.organizationId
        }
      });

      if (!contact) {
        return res.status(400).json({ error: 'Invalid contact' });
      }
    }

    // Create expense
    const expense = await prisma.expense.create({
      data: {
        description,
        date: new Date(date),
        amount,
        reference,
        accountId,
        receiptUrl,
        category,
        organizationId: req.user.organizationId,
        contactId
      },
      include: {
        contact: true
      }
    });

    return res.status(201).json(expense);
  } catch (error) {
    console.error('Error creating expense:', error);
    return res.status(500).json({ error: 'Server error while creating expense' });
  }
};

/**
 * Update an expense
 * @route PUT /api/expenses/:id
 */
export const updateExpense = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { description, date, amount, contactId, reference, accountId, receiptUrl, status, category } = req.body;

    // Check if expense exists and belongs to user's organization
    const existingExpense = await prisma.expense.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      }
    });

    if (!existingExpense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Update expense details
    const updatedExpense = await prisma.expense.update({
      where: { id },
      data: {
        description,
        date: date ? new Date(date) : undefined,
        amount,
        contactId,
        reference,
        accountId,
        receiptUrl,
        category,
        status
      },
      include: {
        contact: true
      }
    });

    return res.status(200).json(updatedExpense);
  } catch (error) {
    console.error('Error updating expense:', error);
    return res.status(500).json({ error: 'Server error while updating expense' });
  }
};

/**
 * Delete an expense
 * @route DELETE /api/expenses/:id
 */
export const deleteExpense = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;

    // Check if expense exists and belongs to user's organization
    const existingExpense = await prisma.expense.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      },
      include: {
        transactions: true
      }
    });

    if (!existingExpense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Don't allow deletion if there are linked transactions
    if (existingExpense.transactions && existingExpense.transactions.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete expense with linked transactions. Void it instead.' 
      });
    }

    // Delete expense (cascade will handle line items)
    await prisma.expense.delete({
      where: { id }
    });

    return res.status(200).json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return res.status(500).json({ error: 'Server error while deleting expense' });
  }
}; 