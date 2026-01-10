import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('\n=== LEADS ===\n');

  const leads = await prisma.lead.findMany({
    include: {
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (leads.length === 0) {
    console.log('No leads found yet.');
    return;
  }

  console.log(`Found ${leads.length} lead(s):\n`);

  for (const lead of leads) {
    console.log('─'.repeat(60));
    console.log(`Session ID: ${lead.sessionId}`);
    console.log(`Status: ${lead.status}`);
    console.log(`Email: ${lead.email || '(not captured)'}`);
    console.log(`Company: ${lead.companyName || '(not captured)'}`);
    console.log(`Revenue Range: ${lead.revenueRange || '(not captured)'}`);
    console.log(`Pain Points: ${lead.painPoints.length > 0 ? lead.painPoints.join(', ') : '(none identified)'}`);
    console.log(`Qualification Score: ${lead.qualificationScore}/100`);
    console.log(`Calendly Booked: ${lead.calendlyBooked ? 'Yes' : 'No'}`);
    console.log(`Source: ${lead.source || '(direct)'}`);
    console.log(`Created: ${lead.createdAt.toLocaleString()}`);
    console.log(`IP: ${lead.ipAddress || 'unknown'}`);
    console.log(`\nConversation (${lead.messages.length} messages):`);

    for (const msg of lead.messages) {
      const role = msg.role === 'user' ? '👤 User' : '🤖 Bot';
      console.log(`  ${role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
    }
    console.log('');
  }

  // Summary stats
  console.log('─'.repeat(60));
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total Leads: ${leads.length}`);
  console.log(`With Email: ${leads.filter(l => l.email).length}`);
  console.log(`Qualified: ${leads.filter(l => l.status === 'QUALIFIED').length}`);
  console.log(`Booked Calls: ${leads.filter(l => l.calendlyBooked).length}`);
  console.log(`Avg Qualification Score: ${Math.round(leads.reduce((sum, l) => sum + l.qualificationScore, 0) / leads.length)}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
