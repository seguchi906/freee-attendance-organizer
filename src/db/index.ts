import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@/db/schema";

const connectionString = process.env.DATABASE_URL;
export const databaseConfigured = Boolean(connectionString && !connectionString.includes("USER:PASSWORD@HOST"));

export function getDb() {
  if (!databaseConfigured) throw new Error("DATABASE_URLが設定されていません。");
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}
