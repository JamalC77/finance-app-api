import { Organization, Prisma } from '@prisma/client';
import { BaseService, prisma } from './baseService';

export class OrganizationService implements BaseService<Organization> {
  async create(data: Prisma.OrganizationCreateInput): Promise<Organization> {
    return prisma.organization.create({
      data
    });
  }

  async findById(id: string): Promise<Organization | null> {
    return prisma.organization.findUnique({
      where: { id }
    });
  }

  async findAll(): Promise<Organization[]> {
    return prisma.organization.findMany();
  }

  async update(id: string, data: Prisma.OrganizationUpdateInput): Promise<Organization> {
    return prisma.organization.update({
      where: { id },
      data
    });
  }

  async delete(id: string): Promise<Organization> {
    // First delete all related records that have foreign key constraints
    await this.deleteRelatedRecords(id);
    
    return prisma.organization.delete({
      where: { id }
    });
  }

  private async deleteRelatedRecords(organizationId: string): Promise<void> {
    // This needs to be done in order based on dependencies
    // First delete records that depend on other records
    await prisma.ledgerEntry.deleteMany({ 
      where: { 
        transaction: { 
          organizationId 
        } 
      } 
    });
    
    await prisma.statementTransaction.deleteMany({
      where: {
        statement: {
          organizationId
        }
      }
    });
    
    await prisma.invoiceLineItem.deleteMany({
      where: {
        invoice: {
          organizationId
        }
      }
    });
    
    // Now delete records that other records depend on
    await prisma.reconciliationStatement.deleteMany({ where: { organizationId } });
    await prisma.bankConnection.deleteMany({ where: { organizationId } });
    await prisma.transaction.deleteMany({ where: { organizationId } });
    await prisma.payment.deleteMany({
      where: {
        OR: [
          { invoice: { organizationId } },
          { expense: { organizationId } }
        ]
      }
    });
    await prisma.invoice.deleteMany({ where: { organizationId } });
    await prisma.expense.deleteMany({ where: { organizationId } });
    await prisma.product.deleteMany({ where: { organizationId } });
    await prisma.taxCategory.deleteMany({ where: { organizationId } });
    await prisma.contact.deleteMany({ where: { organizationId } });
    await prisma.account.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { organizationId } });
  }
}

export const organizationService = new OrganizationService(); 