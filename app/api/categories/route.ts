import {withAdminSession} from '@/lib/require-admin';
import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";
import {mediaUrl} from "@/lib/desktop-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const connection = () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
};

async function handleGET() {
  const sql = connection();
  try {
    const rows = await sql.unsafe("select id, name, is_active, image_url, show_on_home from product_categories order by name");
    return NextResponse.json(await Promise.all(rows.map(async(row) => ({ id: row.id, name: row.name, isActive: row.is_active, imageUrl: await mediaUrl(row.image_url), showOnHome: row.show_on_home }))));
  } catch (error) {
    console.error("categories.get", error);void logSystemError("categories.get", error);
    return NextResponse.json({ error: "Kateqoriyalar yüklənmədi" }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function handlePOST(request: Request) {
  const sql = connection();
  try {
    const body = await request.json() as { name?: string; id?: string; isActive?: boolean; showOnHome?: boolean };
    const name = String(body.name || "").trim();
    if (body.id && !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: "Kateqoriya düzgün deyil" }, { status: 400 });
    if (body.id && typeof body.showOnHome === "boolean") {
      const [row] = await sql.unsafe("update product_categories set show_on_home=$1 where id=$2 returning id", [body.showOnHome, body.id]);
      if (!row) return NextResponse.json({ error: "Kateqoriya tapılmadı" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
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

export const GET=withAdminSession(handleGET);
export const POST=withAdminSession(handlePOST);
