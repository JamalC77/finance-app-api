import { Contact, Prisma, ContactType } from '@prisma/client';
import { BaseService, prisma } from './baseService';

export interface ContactCreateInput extends Omit<Prisma.ContactUncheckedCreateInput, 'organizationId'> {}
export interface ContactUpdateInput extends Omit<Prisma.ContactUncheckedUpdateInput, 'organizationId'> {}

export class ContactService implements BaseService<Contact> {
  async create(data: ContactCreateInput, organizationId: string): Promise<Contact> {
    return prisma.contact.create({
      data: {
        ...data,
        organizationId
      }
    });
  }

  async findById(id: string, organizationId: string): Promise<Contact | null> {
    return prisma.contact.findFirst({
      where: {
        id,
        organizationId
      }
    });
  }

  async findAll(organizationId: string, options?: { type?: ContactType, isActive?: boolean }): Promise<Contact[]> {
    return prisma.contact.findMany({
      where: {
        organizationId,
        ...(options?.type && { type: options.type }),
        ...(options?.isActive !== undefined && { isActive: options.isActive })
      },
      orderBy: { name: 'asc' }
    });
  }

  async update(id: string, data: ContactUpdateInput, organizationId: string): Promise<Contact> {
    return prisma.contact.update({
      where: {
        id,
      },
      data
    });
  }

  async delete(id: string, organizationId: string): Promise<Contact> {
    // Check if contact has invoices or expenses before deleting
    const hasInvoices = await prisma.invoice.count({
      where: { contactId: id }
    }) > 0;

    const hasExpenses = await prisma.expense.count({
      where: { contactId: id }
    }) > 0;

    if (hasInvoices || hasExpenses) {
      throw new Error('Cannot delete contact with linked transactions');
    }

    return prisma.contact.delete({
      where: { id }
    });
  }

  async findByEmail(email: string, organizationId: string): Promise<Contact | null> {
    return prisma.contact.findFirst({
      where: {
        email,
        organizationId
      }
    });
  }

  async getContactWithInvoices(id: string, organizationId: string): Promise<any> {
    return prisma.contact.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        invoices: {
          orderBy: { date: 'desc' }
        }
      }
    });
  }

  async getContactWithExpenses(id: string, organizationId: string): Promise<any> {
    return prisma.contact.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        expenses: {
          orderBy: { date: 'desc' }
        }
      }
    });
  }
}

export const contactService = new ContactService(); 