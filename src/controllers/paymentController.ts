import { Request, Response } from 'express';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../models/prisma';
import { sendPaymentReceipt, sendPaymentNotification } from '../services/emailService';

// Initialize Stripe with secret key from environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-02-24.acacia',
});

// Define types for Stripe payment links
type PriceData = {
  currency: string;
  product_data: {
    name: string;
  };
  unit_amount: number;
};

type PaymentLinkLineItem = {
  price_data: PriceData;
  quantity: number;
};

/**
 * Create a Stripe payment intent for an invoice
 */
export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { invoiceId, paymentMethodId, isExpedited } = req.body;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!invoiceId) {
      return res.status(400).json({ error: 'Invoice ID is required' });
    }
    
    // Get invoice details
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId
      },
      include: {
        contact: true
      }
    });
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Get or create Stripe customer
    let customerId: string;
    
    if ((invoice.contact as any).stripeCustomerId) {
      customerId = (invoice.contact as any).stripeCustomerId;
    } else {
      // Create a new customer in Stripe
      const customerParams: Stripe.CustomerCreateParams = {
        email: invoice.contact.email || undefined,
        name: invoice.contact.name,
        metadata: {
          contactId: invoice.contact.id,
          organizationId: organizationId || ''
        }
      };
      
      const customer = await stripe.customers.create(customerParams);
      
      customerId = customer.id;
      
      // Update contact with Stripe customer ID
      await prisma.contact.update({
        where: {
          id: invoice.contact.id
        },
        data: {
          stripeCustomerId: customerId
        }
      });
    }
    
    // Calculate application fee (3% of invoice total as per your revenue model)
    let applicationFeeAmount = Math.round(invoice.total * 0.03 * 100); // Convert to cents
    
    // Add expedited processing fee if expedited option is selected
    let totalAmount = invoice.total;
    let metadata: Record<string, any> = {
      invoiceId,
      organizationId: organizationId || null
    };
    
    if (isExpedited) {
      // Calculate expedited fee (additional 1.5% or minimum $5)
      const expeditedFeePercent = 0.015;
      const expeditedFeeMinimum = 5;
      const calculatedFee = Math.max(invoice.total * expeditedFeePercent, expeditedFeeMinimum);
      
      // Add expedited fee to total and application fee
      totalAmount += calculatedFee;
      applicationFeeAmount += Math.round(calculatedFee * 100); // Convert to cents
      
      // Add expedited info to metadata
      metadata.isExpedited = true;
      metadata.expeditedFee = calculatedFee;
    }
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalAmount * 100), // Convert to cents
      currency: 'usd', // Should be dynamic based on organization settings
      customer: customerId,
      payment_method: paymentMethodId || undefined,
      confirm: !!paymentMethodId,
      application_fee_amount: applicationFeeAmount,
      metadata
    });
    
    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      totalAmount
    });
  } catch (error: any) {
    console.error('Error in createPaymentIntent controller:', error);
    return res.status(500).json({
      error: 'Failed to create payment intent',
      message: error.message
    });
  }
};

/**
 * Handle Stripe webhook events
 */
export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      endpointSecret as string
    );
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await handleSuccessfulPayment(paymentIntent);
      break;
      
    case 'payment_intent.payment_failed':
      const failedPaymentIntent = event.data.object as Stripe.PaymentIntent;
      await handleFailedPayment(failedPaymentIntent);
      break;
      
    // Handle other event types as needed
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
  
  // Return 200 success response to acknowledge receipt of the event
  res.json({ received: true });
};

/**
 * Handle successful payment
 */
const handleSuccessfulPayment = async (paymentIntent: Stripe.PaymentIntent) => {
  const { invoiceId, organizationId, isExpedited, expeditedFee } = paymentIntent.metadata;
  
  if (!invoiceId || !organizationId) {
    console.error('Missing metadata in payment intent');
    return;
  }
  
  try {
    // Create a payment record in the database
    const paymentAmount = paymentIntent.amount / 100; // Convert from cents
    const processingFee = (paymentIntent.application_fee_amount || 0) / 100; // Convert from cents
    
    const metadata: Record<string, any> = {
      paymentIntentId: paymentIntent.id,
      paymentMethodId: paymentIntent.payment_method,
      receiptUrl: ''
    };
    
    // Add expedited info to metadata if applicable
    if (isExpedited === 'true') {
      metadata.isExpedited = true;
      metadata.expeditedFee = parseFloat(expeditedFee || '0');
    }
    
    // Calculate actual invoice payment amount (minus expedited fee if applicable)
    const invoicePaymentAmount = isExpedited === 'true' && expeditedFee 
      ? paymentAmount - parseFloat(expeditedFee)
      : paymentAmount;
    
    const payment = await prisma.payment.create({
      data: {
        id: uuidv4(),
        amount: invoicePaymentAmount,
        date: new Date(),
        method: 'CREDIT_CARD',
        reference: paymentIntent.id,
        status: 'COMPLETED' as any, // Type assertion to bypass type checking
        processingFee: processingFee,
        metadata: JSON.stringify(metadata),
        invoice: { connect: { id: invoiceId } },
        organization: { connect: { id: organizationId } }
      }
    });
    
    // Update invoice status
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        payments: true
      }
    });
    
    if (invoice) {
      // Calculate total paid amount
      const totalPaid = calculateTotalPaid(invoice.payments);
      
      // Update invoice status based on payment amount
      if (totalPaid >= invoice.total) {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: 'PAID' }
        });
      } else {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: 'PARTIALLY_PAID' }
        });
      }
      
      // Create transaction record for the payment
      const transaction = await prisma.transaction.create({
        data: {
          id: uuidv4(),
          date: new Date(),
          description: `Payment for Invoice #${invoice.number}`,
          reference: paymentIntent.id,
          status: 'CLEARED',
          organizationId,
          invoiceId
        }
      });
      
      // Add ledger entries for the payment transaction
      // This would typically debit a cash/bank account and credit accounts receivable
      // The specific accounts would depend on your chart of accounts
      const cashAccount = await prisma.account.findFirst({
        where: { 
          organizationId,
          type: 'ASSET',
          subtype: 'CASH'
        }
      });
      
      const arAccount = await prisma.account.findFirst({
        where: {
          organizationId,
          type: 'ASSET',
          subtype: 'ACCOUNTS_RECEIVABLE'
        }
      });
      
      if (cashAccount && arAccount) {
        await prisma.ledgerEntry.create({
          data: {
            id: uuidv4(),
            amount: payment.amount,
            transactionId: transaction.id,
            debitAccountId: cashAccount.id,
            creditAccountId: arAccount.id,
            memo: `Payment for Invoice #${invoice.number}`
          }
        });
      }
      
      // Send payment notifications
      try {
        // Send receipt to the customer
        await sendPaymentReceipt(payment.id);
        
        // Send notification to the business owner
        await sendPaymentNotification(payment.id);
      } catch (emailError) {
        console.error('Error sending payment emails:', emailError);
        // Continue processing even if email sending fails
      }
    }
  } catch (error) {
    console.error('Error processing successful payment:', error);
  }
};

/**
 * Handle failed payment
 */
const handleFailedPayment = async (paymentIntent: Stripe.PaymentIntent) => {
  const { invoiceId } = paymentIntent.metadata;
  
  if (!invoiceId) {
    console.error('Missing invoiceId in payment intent metadata');
    return;
  }
  
  try {
    // Log the failed payment attempt
    console.log(`Payment failed for invoice ${invoiceId}: ${paymentIntent.last_payment_error?.message}`);
    
    // You could create a failed payment record or send a notification to the user
  } catch (error) {
    console.error('Error processing failed payment:', error);
  }
};

/**
 * Calculate total paid amount for an invoice
 */
const calculateTotalPaid = (payments: any[]): number => {
  return payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
};

/**
 * Get saved payment methods for a customer
 */
export const getPaymentMethods = async (req: Request, res: Response) => {
  try {
    const { contactId } = req.query;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!contactId) {
      return res.status(400).json({ error: 'Contact ID is required' });
    }
    
    // Get contact
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId as string,
        organizationId
      }
    });
    
    if (!contact || !(contact as any).stripeCustomerId) {
      return res.status(200).json({ paymentMethods: [] });
    }
    
    // Get payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: (contact as any).stripeCustomerId,
      type: 'card'
    });
    
    return res.status(200).json({
      paymentMethods: paymentMethods.data.map(pm => ({
        id: pm.id,
        brand: pm.card?.brand,
        last4: pm.card?.last4,
        expMonth: pm.card?.exp_month,
        expYear: pm.card?.exp_year
      }))
    });
  } catch (error: any) {
    console.error('Error in getPaymentMethods controller:', error);
    return res.status(500).json({
      error: 'Failed to get payment methods',
      message: error.message
    });
  }
};

/**
 * Create a setup intent for a contact
 */
export const createSetupIntent = async (req: Request, res: Response) => {
  try {
    const { contactId } = req.body;
    const organizationId = req.user?.organizationId;
    
    if (!contactId) {
      return res.status(400).json({ error: 'Contact ID is required' });
    }
    
    // Get contact
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        organizationId
      }
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    let customerId: string;
    
    if ((contact as any).stripeCustomerId) {
      customerId = (contact as any).stripeCustomerId;
    } else {
      // Create a new customer in Stripe
      const customerParams: Stripe.CustomerCreateParams = {
        email: contact.email || undefined,
        name: contact.name,
        metadata: {
          contactId,
          organizationId: organizationId || ''
        }
      };
      
      const customer = await stripe.customers.create(customerParams);
      
      customerId = customer.id;
      
      // Save Stripe customer ID to contact
      await prisma.contact.update({
        where: { id: contact.id },
        data: { 
          stripeCustomerId: customerId 
        } as any // Type assertion to bypass type checking
      });
    }
    
    // Create setup intent
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      metadata: {
        contactId: contactId || '',
        organizationId: organizationId || ''
      }
    });
    
    return res.status(200).json({
      clientSecret: setupIntent.client_secret
    });
  } catch (error: any) {
    console.error('Error in createSetupIntent controller:', error);
    return res.status(500).json({
      error: 'Failed to create setup intent',
      message: error.message
    });
  }
};

/**
 * Remove a saved payment method
 */
export const removePaymentMethod = async (req: Request, res: Response) => {
  try {
    const { paymentMethodId, contactId } = req.body;
    const organizationId = req.user?.organizationId;
    
    if (!paymentMethodId || !contactId) {
      return res.status(400).json({ 
        error: 'Payment method ID and contact ID are required' 
      });
    }
    
    // Get contact to verify ownership
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        organizationId
      }
    });
    
    if (!contact || !(contact as any).stripeCustomerId) {
      return res.status(404).json({ error: 'Contact not found or no Stripe customer' });
    }
    
    // Detach payment method from customer
    await stripe.paymentMethods.detach(paymentMethodId);
    
    return res.status(200).json({
      success: true,
      message: 'Payment method removed successfully'
    });
  } catch (error: any) {
    console.error('Error in removePaymentMethod controller:', error);
    return res.status(500).json({
      error: 'Failed to remove payment method',
      message: error.message
    });
  }
};

/**
 * Get a payment link for an invoice
 */
export const getInvoicePaymentLink = async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.id;
    const organizationId = req.user?.organizationId;
    
    if (!invoiceId) {
      return res.status(400).json({ error: 'Invoice ID is required' });
    }
    
    // Get invoice details
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId
      },
      include: {
        contact: true,
        lineItems: true
      }
    });
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Create line items for Stripe
    const lineItems = invoice.lineItems.map(item => ({
      price_data: {
        currency: 'usd', // Should be dynamic based on organization settings
        product_data: {
          name: item.description,
        },
        unit_amount: Math.round(item.unitPrice * 100), // Convert to cents
      },
      quantity: item.quantity,
    }));
    
    // Calculate application fee (3% of invoice total as per your revenue model)
    const applicationFeePercent = 3; // 3%
    
    // Create payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: lineItems as any, // Type assertion to bypass type checking
      application_fee_percent: applicationFeePercent,
      invoice_creation: {
        enabled: true
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.FRONTEND_URL}/invoices/${invoiceId}/paid`
        }
      },
      metadata: {
        invoiceId,
        organizationId: organizationId || ''
      }
    });
    
    return res.status(200).json({
      paymentLink: paymentLink.url
    });
  } catch (error: any) {
    console.error('Error in getInvoicePaymentLink controller:', error);
    return res.status(500).json({
      error: 'Failed to create payment link',
      message: error.message
    });
  }
};

/**
 * Process a payment for an invoice
 */
export const processPayment = async (req: Request, res: Response) => {
  try {
    const { invoiceId, paymentMethodId, amount } = req.body;
    const organizationId = req.user?.organizationId;
    
    if (!invoiceId || !paymentMethodId || !amount) {
      return res.status(400).json({ 
        error: 'Invoice ID, payment method ID, and amount are required' 
      });
    }
    
    // Get invoice details
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId
      },
      include: {
        contact: true
      }
    });
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    if (!(invoice.contact as any).stripeCustomerId) {
      return res.status(400).json({ 
        error: 'Contact does not have a Stripe customer ID' 
      });
    }
    
    // Calculate application fee (3% of amount as per your revenue model)
    const applicationFeeAmount = Math.round(amount * 0.03 * 100); // Convert to cents
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd', // Should be dynamic based on organization settings
      customer: (invoice.contact as any).stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        invoiceId,
        organizationId: organizationId || ''
      }
    });
    
    return res.status(200).json({
      success: true,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status
    });
  } catch (error: any) {
    console.error('Error in processPayment controller:', error);
    return res.status(500).json({
      error: 'Failed to process payment',
      message: error.message
    });
  }
};

/**
 * Attach a payment method to a contact
 */
export const attachPaymentMethod = async (req: Request, res: Response) => {
  try {
    const { paymentMethodId, contactId } = req.body;
    const organizationId = req.user?.organizationId;
    
    if (!paymentMethodId || !contactId) {
      return res.status(400).json({ error: 'Payment method ID and contact ID are required' });
    }
    
    // Get contact to verify ownership
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        organizationId
      }
    });
    
    if (!contact || !(contact as any).stripeCustomerId) {
      return res.status(404).json({ error: 'Contact not found or no Stripe customer' });
    }
    
    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: (contact as any).stripeCustomerId,
    });
    
    return res.status(200).json({
      success: true,
      message: 'Payment method attached successfully'
    });
  } catch (error: any) {
    console.error('Error in attachPaymentMethod controller:', error);
    return res.status(500).json({
      error: 'Failed to attach payment method',
      message: error.message
    });
  }
};

/**
 * Create a checkout session for an invoice
 */
export const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.id;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!invoiceId) {
      return res.status(400).json({ error: 'Invoice ID is required' });
    }
    
    // Get invoice details
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId
      },
      include: {
        contact: true,
        lineItems: true
      }
    });
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Create line items for Stripe
    const lineItems = invoice.lineItems.map((item: { description: string; unitPrice: number; quantity: number }) => ({
      price_data: {
        currency: 'usd', // Should be dynamic based on organization settings
        product_data: {
          name: item.description,
        },
        unit_amount: Math.round(item.unitPrice * 100), // Convert to cents
      },
      quantity: item.quantity,
    }));
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/invoices/${invoiceId}/paid`,
      cancel_url: `${process.env.FRONTEND_URL}/invoices/${invoiceId}/failed`,
      metadata: {
        invoiceId,
        organizationId
      }
    });
    
    return res.status(200).json({
      checkoutSessionId: session.id,
      checkoutSessionUrl: session.url
    });
  } catch (error: any) {
    console.error('Error in createCheckoutSession controller:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      message: error.message
    });
  }
};

/**
 * Process a manual payment for an invoice
 */
export const processManualPayment = async (req: Request, res: Response) => {
  try {
    const { invoiceId, paymentMethodId, amount } = req.body;
    const organizationId = req.user?.organizationId;
    
    if (!invoiceId || !paymentMethodId || !amount) {
      return res.status(400).json({ error: 'Invoice ID, payment method ID, and amount are required' });
    }
    
    // Get invoice details
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId
      },
      include: {
        contact: true
      }
    });
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    if (!(invoice.contact as any).stripeCustomerId) {
      return res.status(400).json({ 
        error: 'Contact does not have a Stripe customer ID' 
      });
    }
    
    // Calculate application fee (3% of amount as per your revenue model)
    const applicationFeeAmount = Math.round(amount * 0.03 * 100); // Convert to cents
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd', // Should be dynamic based on organization settings
      customer: (invoice.contact as any).stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        invoiceId,
        organizationId: organizationId || ''
      }
    });
    
    return res.status(200).json({
      success: true,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status
    });
  } catch (error: any) {
    console.error('Error in processManualPayment controller:', error);
    return res.status(500).json({
      error: 'Failed to process manual payment',
      message: error.message
    });
  }
}; 