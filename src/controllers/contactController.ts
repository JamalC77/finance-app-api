import { Request, Response } from 'express';
import { prisma } from '../models/prisma';
import { Prisma, ContactType } from '@prisma/client';

/**
 * Get all contacts for the current user's organization
 * @route GET /api/contacts
 */
export const getContacts = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { type, isActive } = req.query;
    
    // Build query filters
    const filters: Prisma.ContactWhereInput = {
      organizationId: req.user.organizationId,
      ...(type && { type: type as ContactType }),
      ...(isActive !== undefined && { isActive: isActive === 'true' })
    };

    // Get contacts
    const contacts = await prisma.contact.findMany({
      where: filters,
      orderBy: {
        name: 'asc'
      }
    });

    return res.status(200).json(contacts);
  } catch (error) {
    console.error('Error getting contacts:', error);
    return res.status(500).json({ error: 'Server error while fetching contacts' });
  }
};

/**
 * Get a contact by ID
 * @route GET /api/contacts/:id
 */
export const getContactById = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;

    const contact = await prisma.contact.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      }
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    return res.status(200).json(contact);
  } catch (error) {
    console.error('Error getting contact:', error);
    return res.status(500).json({ error: 'Server error while fetching contact' });
  }
};

/**
 * Create a new contact
 * @route POST /api/contacts
 */
export const createContact = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { name, type, email, phone, address, city, state, zip, country, taxIdentifier, notes } = req.body;

    // Basic validation
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    // Create contact
    const contact = await prisma.contact.create({
      data: {
        name,
        type,
        email,
        phone,
        address,
        city,
        state,
        zip,
        country,
        taxIdentifier,
        notes,
        organizationId: req.user.organizationId
      }
    });

    return res.status(201).json(contact);
  } catch (error) {
    console.error('Error creating contact:', error);
    return res.status(500).json({ error: 'Server error while creating contact' });
  }
};

/**
 * Update a contact
 * @route PUT /api/contacts/:id
 */
export const updateContact = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { name, type, email, phone, address, city, state, zip, country, taxIdentifier, notes, isActive } = req.body;

    // Check if contact exists and belongs to user's organization
    const existingContact = await prisma.contact.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      }
    });

    if (!existingContact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Update contact
    const updatedContact = await prisma.contact.update({
      where: { id },
      data: {
        name,
        type,
        email,
        phone,
        address,
        city,
        state,
        zip,
        country,
        taxIdentifier,
        notes,
        isActive
      }
    });

    return res.status(200).json(updatedContact);
  } catch (error) {
    console.error('Error updating contact:', error);
    return res.status(500).json({ error: 'Server error while updating contact' });
  }
};

/**
 * Delete a contact
 * @route DELETE /api/contacts/:id
 */
export const deleteContact = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;

    // Check if contact exists and belongs to user's organization
    const existingContact = await prisma.contact.findFirst({
      where: {
        id,
        organizationId: req.user.organizationId
      }
    });

    if (!existingContact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Check if contact has related invoices or expenses
    const hasInvoices = await prisma.invoice.count({
      where: { contactId: id }
    }) > 0;

    const hasExpenses = await prisma.expense.count({
      where: { contactId: id }
    }) > 0;

    if (hasInvoices || hasExpenses) {
      return res.status(400).json({ 
        error: 'Cannot delete contact with related invoices or expenses. Deactivate it instead.' 
      });
    }

    // Delete contact
    await prisma.contact.delete({
      where: { id }
    });

    return res.status(200).json({ message: 'Contact deleted successfully' });
  } catch (error) {
    console.error('Error deleting contact:', error);
    return res.status(500).json({ error: 'Server error while deleting contact' });
  }
}; 