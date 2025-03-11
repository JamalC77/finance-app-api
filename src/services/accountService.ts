import { Account, Prisma, AccountType } from '@prisma/client';
import { BaseService, prisma } from './baseService';

export interface AccountCreateInput extends Omit<Prisma.AccountUncheckedCreateInput, 'organizationId'> {}
export interface AccountUpdateInput extends Omit<Prisma.AccountUncheckedUpdateInput, 'organizationId'> {}

export class AccountService implements BaseService<Account> {
  async create(data: AccountCreateInput, organizationId: string): Promise<Account> {
    return prisma.account.create({
      data: {
        ...data,
        organizationId
      }
    });
  }

  async findById(id: string, organizationId: string): Promise<Account | null> {
    return prisma.account.findFirst({
      where: {
        id,
        organizationId
      }
    });
  }

  async findAll(organizationId: string, options?: { type?: AccountType, isActive?: boolean }): Promise<Account[]> {
    return prisma.account.findMany({
      where: {
        organizationId,
        ...(options?.type && { type: options.type }),
        ...(options?.isActive !== undefined && { isActive: options.isActive })
      },
      orderBy: { code: 'asc' }
    });
  }

  async update(id: string, data: AccountUpdateInput, organizationId: string): Promise<Account> {
    return prisma.account.update({
      where: {
        id,
      },
      data
    });
  }

  async delete(id: string, organizationId: string): Promise<Account> {
    // Check if account has transactions before deleting
    const hasLedgerEntries = await prisma.ledgerEntry.count({
      where: {
        OR: [
          { debitAccountId: id },
          { creditAccountId: id }
        ]
      }
    }) > 0;

    if (hasLedgerEntries) {
      throw new Error('Cannot delete account with linked transactions');
    }

    // Check if account has children
    const hasChildren = await prisma.account.count({
      where: { parentId: id }
    }) > 0;

    if (hasChildren) {
      throw new Error('Cannot delete account with child accounts');
    }

    return prisma.account.delete({
      where: { id }
    });
  }

  async getAccountHierarchy(organizationId: string): Promise<Account[]> {
    // Get all accounts
    const accounts = await prisma.account.findMany({
      where: { 
        organizationId,
        parentId: null // Get top-level accounts
      },
      include: {
        children: {
          include: {
            children: {
              include: {
                children: true // Support up to 3 levels of nesting
              }
            }
          }
        }
      },
      orderBy: { code: 'asc' }
    });

    return accounts;
  }

  async getAccountBalance(id: string, organizationId: string): Promise<number> {
    const account = await this.findById(id, organizationId);
    
    if (!account) {
      throw new Error('Account not found');
    }
    
    // Calculate balance from ledger entries
    const debits = await prisma.ledgerEntry.aggregate({
      where: {
        debitAccountId: id,
        transaction: {
          status: {
            not: 'VOIDED'
          }
        }
      },
      _sum: {
        amount: true
      }
    });
    
    const credits = await prisma.ledgerEntry.aggregate({
      where: {
        creditAccountId: id,
        transaction: {
          status: {
            not: 'VOIDED'
          }
        }
      },
      _sum: {
        amount: true
      }
    });
    
    const debitSum = debits._sum.amount || 0;
    const creditSum = credits._sum.amount || 0;
    
    // Calculate balance based on account type (debit vs credit accounts)
    let balance = 0;
    
    switch (account.type) {
      case 'ASSET':
      case 'EXPENSE':
        balance = debitSum - creditSum;
        break;
      case 'LIABILITY':
      case 'EQUITY':
      case 'REVENUE':
        balance = creditSum - debitSum;
        break;
    }
    
    return balance;
  }
}

export const accountService = new AccountService(); 