const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Current working directory:', process.cwd());

// Check if prisma directory exists
const prismaDirPath = path.join(process.cwd(), 'prisma');
console.log('Checking prisma directory:', prismaDirPath);
const prismaExists = fs.existsSync(prismaDirPath);
console.log('Prisma directory exists:', prismaExists);

if (prismaExists) {
  // List contents of prisma directory
  console.log('Contents of prisma directory:');
  const prismaContents = fs.readdirSync(prismaDirPath);
  console.log(prismaContents);

  // Check for schema.prisma
  const schemaPath = path.join(prismaDirPath, 'schema.prisma');
  const schemaExists = fs.existsSync(schemaPath);
  console.log('schema.prisma exists:', schemaExists);

  if (schemaExists) {
    // Show first few lines of schema
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    console.log('First 200 characters of schema.prisma:');
    console.log(schemaContent.substring(0, 200));
  }
}

// Check node and npm versions
console.log('Node version:', process.version);
try {
  const npmVersion = execSync('npm --version').toString().trim();
  console.log('NPM version:', npmVersion);
} catch (error) {
  console.error('Error getting NPM version:', error.message);
}

// List environment variables related to Prisma
console.log('Prisma-related environment variables:');
Object.keys(process.env)
  .filter(key => key.includes('PRISMA') || key.includes('DATABASE'))
  .forEach(key => {
    // Mask sensitive values
    const value = key.includes('DATABASE_URL') 
      ? '[REDACTED]' 
      : process.env[key];
    console.log(`${key}=${value}`);
  }); 