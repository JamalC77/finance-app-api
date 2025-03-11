import { Invoice, InvoiceLineItem, InvoiceStatus, Prisma, Transaction } from '@prisma/client';
import { BaseService, prisma } from './baseService';

export interface InvoiceCreateInput extends Omit<Prisma.InvoiceUncheckedCreateInput, 'organizationId'> {
  lineItems: Omit<Prisma.InvoiceLineItemUncheckedCreateInput, 'invoiceId'>[];
}

export interface InvoiceUpdateInput extends Omit<Prisma.InvoiceUncheckedUpdateInput, 'organizationId'> {
  lineItems?: Omit<Prisma.InvoiceLineItemUncheckedCreateInput, 'invoiceId'>[];
}

export class InvoiceService implements BaseService<Invoice> {
  async create(data: InvoiceCreateInput, organizationId: string): Promise<Invoice> {
    const { lineItems, ...invoiceData } = data;
    
    return prisma.$transaction(async (tx) => {
      // Create the invoice
      const invoice = await tx.invoice.create({
        data: {
          ...invoiceData,
          organizationId
        }
      });
      
      // Add line items
      if (lineItems && lineItems.length > 0) {
        await Promise.all(
          lineItems.map(item => 
            tx.invoiceLineItem.create({
              data: {
                ...item,
                invoiceId: invoice.id
              }
            })
          )
        );
      }
      
      // Return the created invoice with line items
      return tx.invoice.findUnique({
        where: { id: invoice.id },
        include: { lineItems: true }
      }) as Promise<Invoice>;
    });
  }

  async findById(id: string, organizationId: string): Promise<Invoice | null> {
    return prisma.invoice.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        lineItems: true,
        contact: true,
        payments: true
      }
    });
  }

  async findAll(organizationId: string, options?: { status?: InvoiceStatus, contactId?: string }): Promise<Invoice[]> {
    return prisma.invoice.findMany({
      where: {
        organizationId,
        ...(options?.status && { status: options.status }),
        ...(options?.contactId && { contactId: options.contactId })
      },
      include: {
        contact: true,
        lineItems: true,
        payments: true
      },
      orderBy: { date: 'desc' }
    });
  }

  async update(id: string, data: InvoiceUpdateInput, organizationId: string): Promise<Invoice> {
    const { lineItems, ...invoiceData } = data;
    
    return prisma.$transaction(async (tx) => {
      // Update the invoice
      const invoice = await tx.invoice.update({
        where: {
          id,
        },
        data: invoiceData
      });
      
      // Handle line items if they're provided
      if (lineItems) {
        // Delete existing line items
        await tx.invoiceLineItem.deleteMany({
          where: { invoiceId: id }
        });
        
        // Add new line items
        if (lineItems.length > 0) {
          await Promise.all(
            lineItems.map(item => 
              tx.invoiceLineItem.create({
                data: {
                  ...item,
                  invoiceId: id
                }
              })
            )
          );
        }
      }
      
      // Return the updated invoice with line items
      return tx.invoice.findUnique({
        where: { id: invoice.id },
        include: { 
          lineItems: true,
          contact: true,
          payments: true
        }
      }) as Promise<Invoice>;
    });
  }

  async delete(id: string, organizationId: string): Promise<Invoice> {
    return prisma.$transaction(async (tx) => {
      // Delete linked transactions
      await tx.transaction.deleteMany({
        where: { invoiceId: id }
      });
      
      // Delete line items
      await tx.invoiceLineItem.deleteMany({
        where: { invoiceId: id }
      });
      
      // Get invoice before deleting
      const invoice = await tx.invoice.findUnique({
        where: { id }
      });
      
      // Delete the invoice
      await tx.invoice.delete({
        where: { id }
      });
      
      return invoice as Invoice;
    });
  }

  async updateStatus(id: string, status: InvoiceStatus, organizationId: string): Promise<Invoice> {
    return prisma.invoice.update({
      where: {
        id,
      },
      data: { status }
    });
  }
  
  async recordPayment(id: string, paymentAmount: number, organizationId: string): Promise<Invoice> {
    const invoice = await this.findById(id, organizationId);
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    
    // Calculate total paid amount including the new payment
    const currentPaidAmount = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const newTotalPaid = currentPaidAmount + paymentAmount;
    
    // Determine new status based on payment amount
    let newStatus: InvoiceStatus;
    if (newTotalPaid >= invoice.total) {
      newStatus = 'PAID';
    } else if (newTotalPaid > 0) {
      newStatus = 'PARTIALLY_PAID';
    } else {
      newStatus = 'SENT';
    }
    
    // Update invoice status
    return prisma.invoice.update({
      where: { id },
      data: { status: newStatus }
    });
  }
  
  async getNextInvoiceNumber(organizationId: string): Promise<string> {
    const lastInvoice = await prisma.invoice.findFirst({
      where: { organizationId },
      orderBy: { number: 'desc' }
    });
    
    if (!lastInvoice) {
      return 'INV-0001';
    }
    
    // Extract the numeric part and increment
    const match = lastInvoice.number.match(/INV-(\d+)/);
    if (!match) {
      return 'INV-0001';
    }
    
    const nextNumber = parseInt(match[1], 10) + 1;
    return `INV-${nextNumber.toString().padStart(4, '0')}`;
  }
}

// Line Item Service
export class InvoiceLineItemService {
  async create(data: Omit<Prisma.InvoiceLineItemUncheckedCreateInput, 'amount'>, invoiceId: string): Promise<InvoiceLineItem> {
    // Calculate the amount
    const amount = data.quantity * data.unitPrice;
    
    return prisma.invoiceLineItem.create({
      data: {
        ...data,
        amount,
        invoiceId
      }
    });
  }
  
  async update(id: string, data: Omit<Prisma.InvoiceLineItemUncheckedUpdateInput, 'amount'>): Promise<InvoiceLineItem> {
    // Get current item to calculate new amount if needed
    const currentItem = await prisma.invoiceLineItem.findUnique({
      where: { id }
    });
    
    if (!currentItem) {
      throw new Error('Invoice line item not found');
    }
    
    // Calculate new amount if quantity or unitPrice changed
    let amount;
    if (data.quantity !== undefined || data.unitPrice !== undefined) {
      const newQuantity = data.quantity !== undefined ? Number(data.quantity) : currentItem.quantity;
      const newUnitPrice = data.unitPrice !== undefined ? Number(data.unitPrice) : currentItem.unitPrice;
      amount = newQuantity * newUnitPrice;
    }
    
    return prisma.invoiceLineItem.update({
      where: { id },
      data: {
        ...data,
        ...(amount !== undefined && { amount })
      }
    });
  }
  
  async delete(id: string): Promise<InvoiceLineItem> {
    return prisma.invoiceLineItem.delete({
      where: { id }
    });
  }
}

export const invoiceService = new InvoiceService();
export const invoiceLineItemService = new InvoiceLineItemService(); 