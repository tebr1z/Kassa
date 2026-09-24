import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");

const client = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  prepare: false,
});

try {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL UNIQUE,
      created_at bigint NOT NULL
    )
  `);

  const files = (await readdir("./drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sqlText = await readFile(path.join("./drizzle", file), "utf8");
    const hash = createHash("sha256").update(sqlText).digest("hex");
    const found = await client.unsafe(
      "SELECT 1 FROM public.__drizzle_migrations WHERE hash = $1 LIMIT 1",
      [hash],
    );
    if (found.length) continue;

    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    await client.begin(async (transaction) => {
      for (const statement of statements) await transaction.unsafe(statement);
      await transaction.unsafe(
        "INSERT INTO public.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        [hash, Date.now()],
      );
    });
    console.log(`Applied ${file}`);
  }

  console.log("Migrations applied successfully.");
} finally {
  await client.end({ timeout: 5 });
}
