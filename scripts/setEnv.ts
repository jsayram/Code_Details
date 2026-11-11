import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

export function setEnv() {
// The isolated test harness (tests/support/isolation.ts) supplies every
// variable itself; loading any env file would pull in development targets.
if (process.env.CODEDETAILS_ENV_ISOLATED === '1') return;

// Use the current environment set by the package.json scripts
const currentEnvironment = process.env.NODE_ENV || 'development';

// .env.test (and the .env.local fallback) point at the development database,
// so test mode never loads them. Fail closed instead.
if (currentEnvironment === 'test') {
  throw new Error('Refusing to load env files with NODE_ENV=test: they target the development database. Use the isolated test harness.');
}

console.log(`🚀 Loading environment for: ${currentEnvironment}`);

// Map environment names to their respective .env files
const envFileMap: Record<string, string> = {
  development: '.env.development',
  test: '.env.test',
  production: '.env.production'
};

// Determine the expected .env file
let envFilePath = envFileMap[currentEnvironment];

// Resolve the absolute path of the expected .env file
const resolvedEnvPath = path.resolve(process.cwd(), envFilePath);

// Check if the expected .env file exists
if (!fs.existsSync(resolvedEnvPath)) {
  console.warn(`⚠️ Environment file ${envFilePath} not found. Falling back to .env.local.`);
  
  // Default to .env.local if the expected file is missing
  envFilePath = '.env.local';
}

// Load environment variables from the selected .env file
dotenv.config({ path: path.resolve(process.cwd(), envFilePath) });

console.log(`✅ Using environment configuration from: ${envFilePath}`);
}