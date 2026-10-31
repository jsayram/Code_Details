import { setEnv } from "./setEnv";

// load and set environment variables
setEnv();

// validateEnvs.ts - Ensures all required environment variables are set before the app runs.
// E03: the Supabase and DATABASE_URL names are gone; the app has no Supabase
// client or database connection. Nothing else is required here yet: without
// CODEDETAILS_CONVEX_URL the data layer fails closed on its own.
const requiredEnvVars: string[] = [];

// ❌ Future Features (Not MVP) - Uncomment when needed
const futureEnvVars = [
  // "STRIPE_SECRET_KEY", // Payments - not MVP
  // "NEXT_PUBLIC_STRIPE_PUBLIC_KEY", // Payments - not MVP
  // "JWT_SECRET", // Custom JWT - not needed (Better Auth signs its own)
];

//Check which required environment variables are missing.
const missingVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

//If any required variables are missing, log an error and stop the process.
if (missingVars.length > 0) {
  console.error(`🚨 Missing required environment variables: ${missingVars.join(", ")} \n ❌ Exiting program ❌`);
  process.exit(1); // Exit the process to prevent the app from running without essential config.
} else {
  console.log("✅ All required environment variables are set"); // Success message
}
