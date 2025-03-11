import { Request, Response } from 'express';
import { prisma } from '../models/prisma';
import { Prisma } from '@prisma/client';

/**
 * Get all invoices for the current user's organization
 * @route GET /api/invoices
 */
export const getInvoices = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { startDate, endDate, contactId, status } = req.query;
    
    // Build query filters
    const filters: Prisma.InvoiceWhereInput = {
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

    // Get invoices with minimal data for listing
    const invoices = await prisma.invoice.findMany({
      where: filters,
      select: {
        id: true,
        number: true,
        date: true,
        dueDate: true,
        status: true,
        total: true,
        contact: {
          select: {
            id: true,
            name: true
          }
        },
        payments: {
          select: {
            id: true,
            amount: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });

    // Process dates to ensure they're properly formatted
    const processedInvoices = invoices.map(invoice => ({
      ...invoice,
      // Convert date objects to ISO strings to ensure proper JSON serialization
      date: invoice.date ? invoice.date.toISOString() : null,
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null
    }));

    return res.status(200).json(processedInvoices);
  } catch (error) {
    console.error('Error getting invoices:', error);
    return res.status(500).json({ error: 'Server error while fetching invoices' });
  }
};

/**
 * Get an invoice by ID
 * @route GET /api/invoices/:id
 */
export const getInvoiceById = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      },
      include: {
        contact: true,
        lineItems: true,
        payments: true,
        transactions: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    return res.status(200).json(invoice);
  } catch (error) {
    console.error('Error getting invoice:', error);
    return res.status(500).json({ error: 'Server error while fetching invoice' });
  }
};

/**
 * Create a new invoice
 * @route POST /api/invoices
 */
export const createInvoice = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { number, date, dueDate, contactId, subtotal, taxAmount, total, notes, terms, lineItems } = req.body;

    // Basic validation
    if (!number || !date || !dueDate || !contactId || !lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ error: 'Missing required invoice data' });
    }

    // Validate contact belongs to organization
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        organizationId: req.user.organizationId
      }
    });

    if (!contact) {
      return res.status(400).json({ error: 'Invalid contact' });
    }

    // Create invoice with nested line items
    const invoice = await prisma.invoice.create({
      data: {
        number,
        date: new Date(date),
        dueDate: new Date(dueDate),
        subtotal,
        taxAmount: taxAmount || 0,
        total,
        notes,
        terms,
        organizationId: req.user.organizationId,
        contactId,
        lineItems: {
          create: lineItems.map((item: any) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            taxRate: item.taxRate || 0,
            taxAmount: item.taxAmount || 0
          }))
        }
      },
      include: {
        contact: true,
        lineItems: true
      }
    });

    return res.status(201).json(invoice);
  } catch (error) {
    console.error('Error creating invoice:', error);
    return res.status(500).json({ error: 'Server error while creating invoice' });
  }
};

/**
 * Update an invoice
 * @route PUT /api/invoices/:id
 */
export const updateInvoice = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { number, date, dueDate, contactId, subtotal, taxAmount, total, notes, terms, status } = req.body;

    // Check if invoice exists and belongs to user's organization
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      }
    });

    if (!existingInvoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Update invoice details (not line items in this simple implementation)
    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: {
        number,
        date: date ? new Date(date) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        contactId,
        subtotal,
        taxAmount,
        total,
        notes,
        terms,
        status
      },
      include: {
        contact: true,
        lineItems: true,
        payments: true
      }
    });

    return res.status(200).json(updatedInvoice);
  } catch (error) {
    console.error('Error updating invoice:', error);
    return res.status(500).json({ error: 'Server error while updating invoice' });
  }
};

/**
 * Delete an invoice
 * @route DELETE /api/invoices/:id
 */
export const deleteInvoice = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;

    // Check if invoice exists and belongs to user's organization
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      },
      include: {
        payments: true
      }
    });

    if (!existingInvoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Don't allow deletion if there are payments
    if (existingInvoice.payments && existingInvoice.payments.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete invoice with payments. Void it instead.' 
      });
    }

    // Delete invoice (cascade will handle line items)
    await prisma.invoice.delete({
      where: { id }
    });

    return res.status(200).json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    return res.status(500).json({ error: 'Server error while deleting invoice' });
  }
}; 