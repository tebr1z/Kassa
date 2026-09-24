import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL yoxdur" }, { status: 500 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    const rows = await sql.unsafe("select id, name, code from warehouses order by name");
    return NextResponse.json(rows);
  } finally {
    await sql.end({ timeout: 2 });
  }
}
