import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const connection = () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
};

export async function GET() {
  const sql = connection();
  try {
    const rows = await sql.unsafe("select id, name, is_active from product_categories order by name");
    return NextResponse.json(rows.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active })));
  } catch (error) {
    console.error("categories.get", error);void logSystemError("categories.get", error);
    return NextResponse.json({ error: "Kateqoriyalar yüklənmədi" }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export async function POST(request: Request) {
  const sql = connection();
  try {
    const body = await request.json() as { name?: string; id?: string; isActive?: boolean };
    const name = String(body.name || "").trim();
    if (body.id) {
      await sql.unsafe("update product_categories set is_active=$1 where id=$2", [Boolean(body.isActive), body.id]);
      return NextResponse.json({ ok: true });
    }
    if (name.length < 2) return NextResponse.json({ error: "Kateqoriya adını yazın" }, { status: 400 });
    const [row] = await sql.unsafe("insert into product_categories (name) values ($1) returning id, name", [name]);
    return NextResponse.json({ id: row.id, name: row.name, isActive: true }, { status: 201 });
  } catch (error: any) {
    const duplicate = error?.code === "23505";
    return NextResponse.json({ error: duplicate ? "Bu kateqoriya artıq var" : "Kateqoriya saxlanmadı" }, { status: duplicate ? 409 : 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
