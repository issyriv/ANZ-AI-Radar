// Load .env.local for standalone tsx scripts (Next.js loads it automatically,
// but plain node/tsx does not). Import this FIRST in every script.
import { config } from "dotenv";
config({ path: ".env.local" });
