import { Request, Response } from 'express';
import { prisma } from '../models/prisma';
import { v4 as uuidv4 } from 'uuid';
import Stripe from 'stripe';

// Initialize Stripe with the API key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia', // Use the latest API version
});

/**
 * Get a public invoice by ID
 * This endpoint allows clients to view their invoices without authentication
 * Security is provided by unique invoice IDs that are hard to guess
 */
export const getPublicInvoice = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get the invoice with related data
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        contact: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        },
        lineItems: true,
        payments: {
          orderBy: { date: 'desc' },
          select: {
            id: true,
            amount: true,
            date: true,
            method: true,
            reference: true,
            status: true
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Check if the invoice is allowed to be publicly accessed
    if (invoice.status === 'DRAFT' || invoice.status === 'VOIDED') {
      return res.status(403).json({ error: 'This invoice is not available for public access' });
    }

    return res.status(200).json(invoice);
  } catch (error) {
    console.error('Error getting public invoice:', error);
    return res.status(500).json({ error: 'Server error while fetching invoice' });
  }
};

/**
 * Create a payment intent for a public invoice
 * Allows clients to initiate payment without authentication
 */
export const createPublicPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { invoiceId, isExpedited } = req.body;
    
    if (!invoiceId) {
      return res.status(400).json({ error: 'Invoice ID is required' });
    }
    
    // Get invoice details
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        organization: true,
        contact: true,
        payments: true
      }
    });
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Check if invoice is available for payment
    if (invoice.status === 'DRAFT' || invoice.status === 'VOIDED' || invoice.status === 'PAID') {
      return res.status(400).json({ 
        error: 'This invoice is not available for payment' 
      });
    }
    
    // Calculate how much has been paid already
    const paidAmount = invoice.payments?.reduce((sum, payment) => sum + payment.amount, 0) || 0;
    const remainingAmount = invoice.total - paidAmount;
    
    if (remainingAmount <= 0) {
      return res.status(400).json({ error: 'This invoice has already been paid in full' });
    }
    
    // Get or create Stripe customer
    let customerId: string;
    
    if (invoice.contact.stripeCustomerId) {
      customerId = invoice.contact.stripeCustomerId;
    } else {
      // Create a new customer in Stripe
      const customerParams: Stripe.CustomerCreateParams = {
        email: invoice.contact.email || undefined,
        name: invoice.contact.name,
        metadata: {
          contactId: invoice.contact.id,
          organizationId: invoice.organizationId
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
    
    // Calculate application fee (3% of invoice total as per the revenue model)
    let applicationFeeAmount = Math.round(remainingAmount * 0.03 * 100); // Convert to cents
    
    // Add expedited processing fee if expedited option is selected
    let totalAmount = remainingAmount;
    let metadata: Record<string, any> = {
      invoiceId,
      organizationId: invoice.organizationId
    };
    
    if (isExpedited) {
      // Calculate expedited fee (additional 1.5% or minimum $5)
      const expeditedFeePercent = 0.015;
      const expeditedFeeMinimum = 5;
      const calculatedFee = Math.max(remainingAmount * expeditedFeePercent, expeditedFeeMinimum);
      
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
      application_fee_amount: applicationFeeAmount,
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });
    
    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      totalAmount
    });
  } catch (error: any) {
    console.error('Error in createPublicPaymentIntent controller:', error);
    return res.status(500).json({
      error: 'Failed to create payment intent',
      message: error.message
    });
  }
}; 