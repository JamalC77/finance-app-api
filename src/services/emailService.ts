import nodemailer from 'nodemailer';
import { prisma } from '../models/prisma';
import { format } from 'date-fns';

// Get email configuration from environment variables
const emailConfig = {
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
};

// Create a reusable transporter
const transporter = nodemailer.createTransport(emailConfig);

/**
 * Format currency for email display
 */
function formatCurrency(amount: number, currencyCode = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode
  }).format(amount);
}

/**
 * Send a payment receipt to the customer
 */
export async function sendPaymentReceipt(paymentId: string): Promise<boolean> {
  try {
    // Get payment with related invoice and organization
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            contact: true,
            organization: true
          }
        },
        organization: true
      }
    });

    if (!payment || !payment.invoice || !payment.invoice.contact) {
      console.error('Payment, invoice, or contact not found');
      return false;
    }

    // Get email target
    const toEmail = payment.invoice.contact.email;
    if (!toEmail) {
      console.error('Contact email not found');
      return false;
    }

    // Format the payment date
    const paymentDate = format(new Date(payment.date), 'MMMM d, yyyy');
    
    // Get organization details
    const organization = payment.invoice.organization;
    const orgName = organization?.name || 'Our Company';
    const fromEmail = organization?.email || process.env.DEFAULT_FROM_EMAIL || 'noreply@example.com';

    // Prepare email content
    const subject = `Receipt for Payment to ${orgName}`;
    
    // Generate payment receipt HTML
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 3px solid #4f46e5;">
          <h2 style="color: #4f46e5; margin: 0;">Payment Receipt</h2>
        </div>
        
        <div style="padding: 20px;">
          <p>Dear ${payment.invoice.contact.name},</p>
          
          <p>Thank you for your payment. This email confirms that we have received your payment for invoice #${payment.invoice.number}.</p>
          
          <div style="background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 5px; padding: 15px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Payment Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Amount Paid:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; font-weight: bold; text-align: right;">${formatCurrency(payment.amount)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Payment Date:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">${paymentDate}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Payment Method:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">${payment.method.replace('_', ' ')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Reference Number:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">${payment.reference || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">Invoice Number:</td>
                <td style="padding: 8px 0; text-align: right;">#${payment.invoice.number}</td>
              </tr>
            </table>
          </div>
          
          <p>If you have any questions about this payment or your invoice, please don't hesitate to contact us.</p>
          
          <p>
            Best regards,<br>
            The ${orgName} Team
          </p>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>This is an automated message from ${orgName}. Please do not reply to this email.</p>
        </div>
      </div>
    `;

    // Send the email
    const info = await transporter.sendMail({
      from: `"${orgName}" <${fromEmail}>`,
      to: toEmail,
      subject,
      html
    });

    console.log('Payment receipt email sent: %s', info.messageId);
    
    // Update payment record to mark receipt as sent
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        metadata: JSON.stringify({
          ...JSON.parse(payment.metadata || '{}'),
          receiptSent: true,
          receiptSentAt: new Date().toISOString(),
          receiptEmailId: info.messageId
        })
      }
    });

    return true;
  } catch (error) {
    console.error('Error sending payment receipt:', error);
    return false;
  }
}

/**
 * Send a payment notification to the organization/business owner
 */
export async function sendPaymentNotification(paymentId: string): Promise<boolean> {
  try {
    // Get payment with related invoice and organization
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            contact: true
          }
        },
        organization: true
      }
    });

    if (!payment || !payment.invoice || !payment.organization) {
      console.error('Payment, invoice, or organization not found');
      return false;
    }

    // Get organization details
    const organization = payment.organization;
    const orgName = organization.name;
    
    // Use the organization email or fall back to admin email
    const toEmail = organization.email || process.env.ADMIN_EMAIL;
    if (!toEmail) {
      console.error('Organization email not found');
      return false;
    }

    // Format the payment date
    const paymentDate = format(new Date(payment.date), 'MMMM d, yyyy');
    
    // Get contact details
    const contact = payment.invoice.contact;
    const contactName = contact?.name || 'A customer';

    // Prepare email content
    const subject = `New Payment Received for Invoice #${payment.invoice.number}`;
    
    // Determine if this payment completes the invoice
    const isPaid = payment.invoice.status === 'PAID';
    
    // Generate payment notification HTML
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 3px solid #10b981;">
          <h2 style="color: #10b981; margin: 0;">Payment Received</h2>
        </div>
        
        <div style="padding: 20px;">
          <p>Hello,</p>
          
          <p>Good news! ${contactName} has made a payment of <strong>${formatCurrency(payment.amount)}</strong> for invoice #${payment.invoice.number}.</p>
          
          ${isPaid ? `<p style="font-weight: bold; color: #10b981;">This payment completes the invoice.</p>` : ''}
          
          <div style="background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 5px; padding: 15px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Payment Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Customer:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">${contactName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Amount Paid:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; font-weight: bold; text-align: right;">${formatCurrency(payment.amount)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Payment Date:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">${paymentDate}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Payment Method:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">${payment.method.replace('_', ' ')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Reference Number:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">${payment.reference || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">Processing Fee:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">${formatCurrency(payment.processingFee || 0)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">Invoice Number:</td>
                <td style="padding: 8px 0; text-align: right;">#${payment.invoice.number}</td>
              </tr>
            </table>
          </div>
          
          <p>You can view the full payment details in your dashboard.</p>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    `;

    // Send the email
    const info = await transporter.sendMail({
      from: `"${orgName} Notifications" <${process.env.NOTIFICATIONS_EMAIL || process.env.EMAIL_USER}>`,
      to: toEmail,
      subject,
      html
    });

    console.log('Payment notification email sent: %s', info.messageId);
    
    // Update payment record to mark notification as sent
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        metadata: JSON.stringify({
          ...JSON.parse(payment.metadata || '{}'),
          notificationSent: true,
          notificationSentAt: new Date().toISOString()
        })
      }
    });

    return true;
  } catch (error) {
    console.error('Error sending payment notification:', error);
    return false;
  }
} 