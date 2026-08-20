import fs from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { Pool } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("USER:PASSWORD@HOST")) {
  throw new Error(".env.localへNeonのDATABASE_URLを設定してください。");
}

const migrationDirectory = path.join(process.cwd(), "drizzle");
const files = (await fs.readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationDirectory, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      await client.query(statement);
    }
  }
  await client.query("COMMIT");
  console.log(`Applied ${files.length} migration file(s).`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
