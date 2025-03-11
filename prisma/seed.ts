import { PrismaClient, UserRole, AccountType, ContactType, TransactionStatus, InvoiceStatus, PaymentMethod, PaymentStatus, ExpenseStatus, ProductType, BankAccountType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Organization ID provided by user
const ORGANIZATION_ID = 'cm7tue8rv0000mncigr50ea2h';

async function main() {
  console.log(`Starting database seeding with organization ID: ${ORGANIZATION_ID}`);

  // Check if organization already exists
  const existingOrg = await prisma.organization.findUnique({
    where: { id: ORGANIZATION_ID }
  });

  if (!existingOrg) {
    console.log("Creating organization...");
    // Create the organization
    await prisma.organization.create({
      data: {
        id: ORGANIZATION_ID,
        name: 'Acme Corporation',
        address: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        zip: '94105',
        country: 'USA',
        phoneNumber: '(555) 123-4567',
        email: 'info@acmecorp.com',
        website: 'www.acmecorp.com',
        taxIdentifier: '12-3456789',
        fiscalYearStart: new Date(2025, 0, 1),
        defaultCurrency: 'USD',
      }
    });
  } else {
    console.log("Organization already exists, using existing organization");
  }

  // Create Users
  console.log("Creating users...");
  const hashedPassword = await bcrypt.hash('password123', 10);
  
  await prisma.user.createMany({
    data: [
      {
        email: 'john@acmecorp.com',
        name: 'John Doe',
        password: hashedPassword,
        role: UserRole.ADMIN,
        organizationId: ORGANIZATION_ID,
      },
      {
        email: 'jane@acmecorp.com',
        name: 'Jane Smith',
        password: hashedPassword,
        role: UserRole.USER,
        organizationId: ORGANIZATION_ID,
      }
    ],
    skipDuplicates: true,
  });

  // Create Accounts (Chart of Accounts)
  console.log("Creating chart of accounts...");
  const accounts = [
    // Assets
    {
      code: '1000',
      name: 'Checking Account',
      type: AccountType.ASSET,
      subtype: 'BANK',
      description: 'Primary business checking account',
      balance: 24500.75,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '1001',
      name: 'Savings Account',
      type: AccountType.ASSET,
      subtype: 'BANK',
      description: 'Business savings account',
      balance: 15000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '1100',
      name: 'Accounts Receivable',
      type: AccountType.ASSET,
      subtype: 'RECEIVABLE',
      description: 'Money owed by customers',
      balance: 8750.50,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '1200',
      name: 'Inventory',
      type: AccountType.ASSET,
      subtype: 'INVENTORY',
      description: 'Value of goods in stock',
      balance: 12350.25,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '1300',
      name: 'Office Equipment',
      type: AccountType.ASSET,
      subtype: 'FIXED_ASSET',
      description: 'Computers, furniture, etc.',
      balance: 5000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    
    // Liabilities
    {
      code: '2000',
      name: 'Accounts Payable',
      type: AccountType.LIABILITY,
      subtype: 'PAYABLE',
      description: 'Money owed to vendors',
      balance: 3250.75,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '2100',
      name: 'Credit Card',
      type: AccountType.LIABILITY,
      subtype: 'CREDIT_CARD',
      description: 'Business credit card',
      balance: 1875.50,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '2200',
      name: 'Loan Payable',
      type: AccountType.LIABILITY,
      subtype: 'LOAN',
      description: 'Business loan',
      balance: 25000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '2300',
      name: 'Sales Tax Payable',
      type: AccountType.LIABILITY,
      subtype: 'TAX',
      description: 'Sales tax collected but not yet paid',
      balance: 1250.25,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    
    // Equity
    {
      code: '3000',
      name: "Owner's Equity",
      type: AccountType.EQUITY,
      subtype: 'EQUITY',
      description: "Owner's investment in the business",
      balance: 35000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '3100',
      name: 'Retained Earnings',
      type: AccountType.EQUITY,
      subtype: 'EQUITY',
      description: 'Accumulated earnings reinvested in the business',
      balance: 12500.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    
    // Revenue
    {
      code: '4000',
      name: 'Sales Revenue',
      type: AccountType.REVENUE,
      subtype: 'REVENUE',
      description: 'Revenue from sales',
      balance: 75000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '4100',
      name: 'Service Revenue',
      type: AccountType.REVENUE,
      subtype: 'REVENUE',
      description: 'Revenue from services',
      balance: 25000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '4200',
      name: 'Interest Income',
      type: AccountType.REVENUE,
      subtype: 'OTHER_INCOME',
      description: 'Interest earned on bank accounts',
      balance: 250.50,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    
    // Expenses
    {
      code: '5000',
      name: 'Rent Expense',
      type: AccountType.EXPENSE,
      subtype: 'OPERATING_EXPENSE',
      description: 'Office rent',
      balance: 12000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '5100',
      name: 'Utilities Expense',
      type: AccountType.EXPENSE,
      subtype: 'OPERATING_EXPENSE',
      description: 'Electricity, water, etc.',
      balance: 3500.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '5200',
      name: 'Salaries Expense',
      type: AccountType.EXPENSE,
      subtype: 'OPERATING_EXPENSE',
      description: 'Employee salaries',
      balance: 45000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '5300',
      name: 'Advertising Expense',
      type: AccountType.EXPENSE,
      subtype: 'OPERATING_EXPENSE',
      description: 'Marketing and advertising',
      balance: 5000.00,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
    {
      code: '5400',
      name: 'Office Supplies Expense',
      type: AccountType.EXPENSE,
      subtype: 'OPERATING_EXPENSE',
      description: 'Office supplies',
      balance: 1250.75,
      organizationId: ORGANIZATION_ID,
      isActive: true,
    },
  ];

  for (const account of accounts) {
    await prisma.account.upsert({
      where: {
        organizationId_code: {
          organizationId: ORGANIZATION_ID,
          code: account.code,
        },
      },
      update: {},
      create: account,
    });
  }

  // Create Contacts
  console.log("Creating contacts...");
  const contacts = [
    {
      name: "Acme Corporation",
      type: ContactType.CUSTOMER,
      email: "billing@acmecorp.com",
      phone: "555-123-4567",
      address: "123 Business Ave, Suite 100",
      city: "San Francisco",
      state: "CA",
      zip: "94107",
      country: "USA",
      notes: "Large enterprise client",
      organizationId: ORGANIZATION_ID,
    },
    {
      name: "TechStart Inc.",
      type: ContactType.CUSTOMER,
      email: "accounts@techstart.io",
      phone: "555-987-6543",
      address: "456 Startup Blvd",
      city: "Austin",
      state: "TX",
      zip: "78701",
      country: "USA",
      notes: "Growing startup, NET-30 terms",
      organizationId: ORGANIZATION_ID,
    },
    {
      name: "GlobalMedia Group",
      type: ContactType.CUSTOMER,
      email: "finance@globalmedia.com",
      phone: "555-456-7890",
      address: "789 Media Row",
      city: "New York",
      state: "NY",
      zip: "10018",
      country: "USA",
      notes: "Media conglomerate, requires PO numbers",
      organizationId: ORGANIZATION_ID,
    },
    {
      name: "Office Supplies Co",
      type: ContactType.VENDOR,
      email: "sales@officesupplies.com",
      phone: "555-222-3333",
      address: "321 Retail Street",
      city: "Chicago",
      state: "IL",
      zip: "60611",
      country: "USA",
      notes: "Preferred vendor for office supplies",
      organizationId: ORGANIZATION_ID,
    },
    {
      name: "City Power & Light",
      type: ContactType.VENDOR,
      email: "support@citypower.com",
      phone: "555-444-5555",
      address: "555 Utility Avenue",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      country: "USA",
      notes: "Utility provider",
      organizationId: ORGANIZATION_ID,
    },
  ];

  await prisma.contact.createMany({
    data: contacts,
    skipDuplicates: true,
  });

  // Get contacts for reference in other entities
  const dbContacts = await prisma.contact.findMany({
    where: { organizationId: ORGANIZATION_ID },
  });

  // Create Tax Categories
  console.log("Creating tax categories...");
  await prisma.taxCategory.createMany({
    data: [
      {
        name: "Standard Rate",
        description: "Standard sales tax",
        rate: 5.0,
        isActive: true,
        organizationId: ORGANIZATION_ID,
      },
      {
        name: "Reduced Rate",
        description: "Reduced rate for certain goods/services",
        rate: 2.5,
        isActive: true,
        organizationId: ORGANIZATION_ID,
      },
      {
        name: "Zero Rate",
        description: "Zero-rated items",
        rate: 0,
        isActive: true,
        organizationId: ORGANIZATION_ID,
      },
    ],
    skipDuplicates: true,
  });

  // Get tax categories for reference
  const taxCategories = await prisma.taxCategory.findMany({
    where: { organizationId: ORGANIZATION_ID },
  });

  // Create Products
  console.log("Creating products...");
  await prisma.product.createMany({
    data: [
      {
        name: 'Standard Plan',
        description: 'Basic software subscription',
        type: ProductType.SERVICE,
        price: 29.99,
        taxable: true,
        isActive: true,
        organizationId: ORGANIZATION_ID,
      },
      {
        name: 'Premium Plan',
        description: 'Advanced software subscription with support',
        type: ProductType.SERVICE,
        price: 99.99,
        taxable: true,
        isActive: true,
        organizationId: ORGANIZATION_ID,
      },
      {
        name: 'Enterprise Plan',
        description: 'Full-featured software with dedicated support',
        type: ProductType.SERVICE,
        price: 299.99,
        taxable: true,
        isActive: true,
        organizationId: ORGANIZATION_ID,
      },
      {
        name: 'Consulting (hourly)',
        description: 'Professional consulting services',
        type: ProductType.SERVICE,
        price: 150.00,
        taxable: true,
        isActive: true,
        organizationId: ORGANIZATION_ID,
      },
      {
        name: 'Hardware Device',
        description: 'IoT hardware device',
        type: ProductType.INVENTORY,
        price: 199.99,
        cost: 120.00,
        taxable: true,
        isActive: true,
        quantityOnHand: 25,
        reorderPoint: 5,
        organizationId: ORGANIZATION_ID,
      },
    ],
    skipDuplicates: true,
  });

  // Get products for reference
  const products = await prisma.product.findMany({
    where: { organizationId: ORGANIZATION_ID },
  });

  // Create Bank Connections
  console.log("Creating bank connections...");
  await prisma.bankConnection.create({
    data: {
      institutionName: 'Business Bank',
      accountName: 'Business Checking',
      accountNumber: '1234',
      accountType: BankAccountType.CHECKING,
      balance: 24500.75,
      isActive: true,
      organizationId: ORGANIZATION_ID,
    }
  });

  // Create Invoices with line items
  console.log("Creating invoices...");
  // Find customer contact
  const customerContact = dbContacts.find(c => c.type === ContactType.CUSTOMER);

  if (customerContact) {
    const stdTaxCategory = taxCategories[0];
    
    // Create invoice 1
    const invoice1 = await prisma.invoice.create({
      data: {
        number: 'INV-001',
        date: new Date("2025-04-15"),
        dueDate: new Date("2025-05-15"),
        status: InvoiceStatus.PAID,
        subtotal: 5000.00,
        taxAmount: 250.00,
        total: 5250.00,
        notes: "Payment received via wire transfer",
        terms: "Net 30",
        contactId: customerContact.id,
        organizationId: ORGANIZATION_ID,
      }
    });

    // Add line items for invoice 1
    await prisma.invoiceLineItem.createMany({
      data: [
        {
          description: "Website Design",
          quantity: 1,
          unitPrice: 2000.00,
          amount: 2000.00,
          taxRate: 5.0,
          invoiceId: invoice1.id,
          taxCategoryId: stdTaxCategory?.id,
        },
        {
          description: "Frontend Development",
          quantity: 20,
          unitPrice: 75.00,
          amount: 1500.00,
          taxRate: 5.0,
          invoiceId: invoice1.id,
          taxCategoryId: stdTaxCategory?.id,
        },
        {
          description: "Backend Integration",
          quantity: 20,
          unitPrice: 75.00,
          amount: 1500.00,
          taxRate: 5.0,
          invoiceId: invoice1.id,
          taxCategoryId: stdTaxCategory?.id,
        }
      ]
    });

    // Create invoice 2
    const invoice2 = await prisma.invoice.create({
      data: {
        number: 'INV-002',
        date: new Date("2025-05-01"),
        dueDate: new Date("2025-06-01"),
        status: InvoiceStatus.DRAFT,
        subtotal: 10000.00,
        taxAmount: 500.00,
        total: 10500.00,
        notes: "Awaiting payment",
        terms: "Net 30",
        contactId: customerContact.id,
        organizationId: ORGANIZATION_ID,
      }
    });

    // Add line items for invoice 2
    await prisma.invoiceLineItem.createMany({
      data: [
        {
          description: "Mobile App UI/UX Design",
          quantity: 1,
          unitPrice: 3500.00,
          amount: 3500.00,
          taxRate: 5.0,
          invoiceId: invoice2.id,
          taxCategoryId: stdTaxCategory?.id,
        },
        {
          description: "iOS Development",
          quantity: 40,
          unitPrice: 85.00,
          amount: 3400.00,
          taxRate: 5.0,
          invoiceId: invoice2.id,
          taxCategoryId: stdTaxCategory?.id,
        },
        {
          description: "Android Development",
          quantity: 40,
          unitPrice: 85.00,
          amount: 3400.00,
          taxRate: 5.0,
          invoiceId: invoice2.id,
          taxCategoryId: stdTaxCategory?.id,
        }
      ]
    });
  }

  // Create Expenses
  console.log("Creating expenses...");
  // Find vendor contact
  const vendorContact = dbContacts.find(c => c.type === ContactType.VENDOR);

  if (vendorContact) {
    await prisma.expense.createMany({
      data: [
        {
          date: new Date("2025-05-10"),
          description: "Office supplies for Q2",
          amount: 235.45,
          status: ExpenseStatus.PAID,
          receiptUrl: "/receipts/EXP-001.pdf",
          contactId: vendorContact.id,
          organizationId: ORGANIZATION_ID,
        },
        {
          date: new Date("2025-05-15"),
          description: "Electricity bill for May",
          amount: 245.75,
          status: ExpenseStatus.PAID,
          receiptUrl: "/receipts/EXP-002.pdf",
          contactId: vendorContact.id,
          organizationId: ORGANIZATION_ID,
        },
        {
          date: new Date("2025-05-18"),
          description: "Web hosting monthly fee",
          amount: 49.99,
          status: ExpenseStatus.PAID,
          receiptUrl: "/receipts/EXP-003.pdf",
          contactId: vendorContact.id,
          organizationId: ORGANIZATION_ID,
        },
        {
          date: new Date("2025-05-22"),
          description: "Client lunch meeting",
          amount: 78.25,
          status: ExpenseStatus.PENDING,
          contactId: vendorContact.id,
          organizationId: ORGANIZATION_ID,
        }
      ]
    });
  }

  // Create Transactions and Ledger Entries
  console.log("Creating transactions...");
  // Get accounts for reference
  const checkingAccount = await prisma.account.findFirst({
    where: { 
      code: '1000',
      organizationId: ORGANIZATION_ID 
    }
  });

  const expenseAccount = await prisma.account.findFirst({
    where: { 
      code: '5400',
      organizationId: ORGANIZATION_ID 
    }
  });

  const accountsReceivable = await prisma.account.findFirst({
    where: { 
      code: '1100',
      organizationId: ORGANIZATION_ID 
    }
  });

  if (checkingAccount && expenseAccount && accountsReceivable) {
    // Expense transaction
    const trans1 = await prisma.transaction.create({
      data: {
        date: new Date(2025, 4, 10), // May 10, 2025
        description: 'Office supplies purchase',
        reference: 'CC-1234',
        status: TransactionStatus.CLEARED,
        organizationId: ORGANIZATION_ID,
      }
    });

    // Create ledger entries for transaction 1
    await prisma.ledgerEntry.createMany({
      data: [
        {
          amount: 125.50,
          memo: 'Office supplies',
          transactionId: trans1.id,
          debitAccountId: expenseAccount.id,
        },
        {
          amount: -125.50,
          memo: 'Office supplies',
          transactionId: trans1.id,
          creditAccountId: checkingAccount.id,
        }
      ]
    });

    // Payment received transaction
    const trans2 = await prisma.transaction.create({
      data: {
        date: new Date(2025, 4, 15), // May 15, 2025
        description: 'Customer payment',
        reference: 'TXREF123456',
        status: TransactionStatus.CLEARED,
        organizationId: ORGANIZATION_ID,
      }
    });

    // Create ledger entries for transaction 2
    await prisma.ledgerEntry.createMany({
      data: [
        {
          amount: 5250.00,
          memo: 'Payment for INV-001',
          transactionId: trans2.id,
          debitAccountId: checkingAccount.id,
        },
        {
          amount: -5250.00,
          memo: 'Payment for INV-001',
          transactionId: trans2.id,
          creditAccountId: accountsReceivable.id,
        }
      ]
    });
  }

  // Create Payments
  console.log("Creating payments...");
  const invoice = await prisma.invoice.findFirst({ 
    where: { 
      number: 'INV-001',
      organizationId: ORGANIZATION_ID 
    } 
  });

  if (invoice) {
    await prisma.payment.create({
      data: {
        date: new Date(2025, 4, 15), // May 15, 2025
        amount: 5250.00,
        method: PaymentMethod.BANK_TRANSFER,
        reference: 'WIRETX123456',
        status: PaymentStatus.COMPLETED,
        notes: 'Payment received via wire transfer',
        invoiceId: invoice.id,
        organizationId: ORGANIZATION_ID,
      }
    });
  }

  console.log("Database seeding completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 