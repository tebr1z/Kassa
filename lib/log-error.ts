import postgres from "postgres";

export async function logSystemError(source: string, error: unknown) {
  const status = Number((error as { statusCode?: number })?.statusCode || 0);
  if (status && status < 500) return;
  if (!process.env.DATABASE_URL) return;
  const message = error instanceof Error ? error.message : String(error || "Naməlum xəta");
  const detail = error instanceof Error ? error.stack || "" : "";
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 5 });
  try {
    await sql.unsafe("insert into system_errors (source, message, detail) values ($1,$2,$3)", [source.slice(0, 120), message.slice(0, 500), detail.slice(0, 4000) || null]);
  } catch {
    /* jurnal sorğunu dayandırmamalıdır */
  } finally {
    await sql.end({ timeout: 1 });
  }
}
