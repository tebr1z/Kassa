import {withAdminSession} from '@/lib/require-admin';
import { spawn } from "node:child_process";
import { logSystemError } from "@/lib/log-error";
import { NextResponse } from "next/server";
import postgres from "postgres";
import {createSnapshot,restoreSnapshot,snapshotTableOrder} from "@/lib/system-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const connection = () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL təyin edilməyib");
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
};

function sqlLiteral(value: unknown) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "object") return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function rowsToSql(table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const body = rows.map((row) => `(${keys.map((key) => sqlLiteral(row[key])).join(",")})`).join(",\n");
  return `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES\n${body};\n`;
}

function dumpWithPgDump() {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.reject(new Error("DATABASE_URL yoxdur"));
  return new Promise<string>((resolve, reject) => {
    const child = spawn("pg_dump", ["--no-owner", "--no-acl", "--format=plain", url], { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(err || "pg_dump alınmadı")));
  });
}

async function fallbackDump(sql: { unsafe: (query: string) => Promise<Record<string, unknown>[]> }) {
  const enums = await sql.unsafe(`select t.typname, string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) labels from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname order by t.typname`);
  const columns = await sql.unsafe(`select c.relname table_name, a.attname column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) data_type, a.attnotnull not_null, pg_get_expr(ad.adbin, ad.adrelid) default_expr from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where n.nspname='public' and c.relkind='r' order by c.relname, a.attnum`);
  const constraints = await sql.unsafe(`select c.relname table_name, pg_get_constraintdef(con.oid) def from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and con.contype in ('p','u','f','c') order by c.relname, con.contype`);
  const indexes = await sql.unsafe(`select indexdef from pg_indexes where schemaname='public' and indexname not in (select conname from pg_constraint) order by tablename, indexname`);
  const edges = await sql.unsafe(`select c.relname child, cf.relname parent from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_class cf on cf.oid=con.confrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and con.contype='f' and c.relname<>cf.relname`);
  const names = [...new Set(columns.map((row) => String(row.table_name)))];
  const parents = new Map(names.map((name) => [name, [] as string[]]));
  for (const edge of edges) parents.get(String(edge.child))?.push(String(edge.parent));
  const ordered: string[] = [];
  const seen = new Set<string>();
  function visit(name: string) {
    if (seen.has(name)) return;
    seen.add(name);
    for (const parent of parents.get(name) || []) if (names.includes(parent)) visit(parent);
    ordered.push(name);
  }
  names.forEach(visit);
  const byTable = new Map<string, string[]>();
  for (const column of columns) {
    const name = String(column.table_name);
    const line = `"${column.column_name}" ${column.data_type}${column.default_expr ? ` DEFAULT ${column.default_expr}` : ""}${column.not_null ? " NOT NULL" : ""}`;
    byTable.set(name, [...(byTable.get(name) || []), line]);
  }
  for (const constraint of constraints) byTable.get(String(constraint.table_name))?.push(String(constraint.def));
  const ddl = [
    "-- BirKassa sxem və məlumat nüsxəsi. pg_dump tapılmadı.",
    ...enums.map((row) => `DO $$ BEGIN CREATE TYPE "${row.typname}" AS ENUM (${row.labels}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`),
    ...ordered.map((name) => `CREATE TABLE IF NOT EXISTS "${name}" (\n  ${(byTable.get(name) || []).join(",\n  ")}\n);`),
    ...indexes.map((row) => String(row.indexdef).replace(/^CREATE INDEX/, "CREATE INDEX IF NOT EXISTS") + ";"),
    "BEGIN;",
  ];
  for (const name of ordered) {
    if (name === "system_backups") continue;
    ddl.push(rowsToSql(name, await sql.unsafe(`select * from "${name}"`)));
  }
  ddl.push("COMMIT;");
  return ddl.filter(Boolean).join("\n");
}

function sqlFile(body: string, filename: string) {
  return new NextResponse(body, { headers: { "Content-Type": "application/sql; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
}

async function handleGET(request: Request) {
  const sql = connection();
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") || "errors";
    if (view === "dump") {
      if (request.headers.get("x-birkassa-role") !== "admin") return NextResponse.json({ error: "SQL ehtiyatını yalnız administrator endirə bilər" }, { status: 403 });
      const backupId = url.searchParams.get("id") || "";
      const stamp = new Date().toISOString().slice(0, 10);
      if (backupId) {
        const [backup] = await sql.unsafe("select label, payload from system_backups where id=$1", [backupId]);
        if (!backup) return NextResponse.json({ error: "Ehtiyat nüsxə tapılmadı" }, { status: 404 });
        const payload = typeof backup.payload === "string" ? JSON.parse(backup.payload) : backup.payload;
        const data=payload.version===2?payload.tables:payload;
        const script = `-- BirKassa ehtiyat: ${backup.label}\nBEGIN;\n${(await snapshotTableOrder(sql)).map((table) => rowsToSql(table, data[table] || [])).join("\n")}COMMIT;\n`;
        return sqlFile(script, `birkassa-${stamp}.sql`);
      }
      try {
        return sqlFile(await dumpWithPgDump(), `birkassa-${stamp}.sql`);
      } catch {
        return sqlFile(await fallbackDump(sql), `birkassa-${stamp}.sql`);
      }
    }
    if (view === "backups") {
      const rows = await sql.unsafe("select b.id, b.label, b.created_at, coalesce(u.full_name,'Sistem') user_name from system_backups b left join users u on u.id=b.created_by order by b.created_at desc limit 20");
      return NextResponse.json(rows);
    }
    const rows = await sql.unsafe("select id, source, message, detail, created_at from system_errors order by created_at desc limit 100");
    return NextResponse.json(rows);
  } catch (error) {
    console.error("system.get", error);void logSystemError("system.get", error);
    return NextResponse.json({ error: "Sistem məlumatı yüklənmədi" }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function handlePOST(request: Request) {
  const sql = connection();
  try {
    const actorId = request.headers.get("x-birkassa-user-id");
    const body = await request.json() as { action?: string; backupId?: string; confirm?: string; source?: string; message?: string; detail?: string };
    if (body.action === "error") {
      const message = String(body.message || "").trim();
      if (!message) return NextResponse.json({ error: "Xəta mətni boşdur" }, { status: 400 });
      await sql.unsafe("insert into system_errors (source, message, detail) values ($1,$2,$3)", [String(body.source || "client"), message.slice(0, 500), String(body.detail || "").slice(0, 4000) || null]);
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    if (body.action === "backup") {
      const payload = await createSnapshot(sql);
      const label = `Ehtiyat ${new Date().toLocaleString("az-AZ", { timeZone: "Asia/Baku" })}`;
      const [row] = await sql.unsafe("insert into system_backups (label, payload, created_by) values ($1,$2::text::jsonb,$3) returning id, label, created_at", [label, JSON.stringify(payload), actorId || null]);
      await sql.unsafe("insert into audit_logs (user_id, action, entity_type, entity_id, after_json) values ($1,'system.backup','backup',$2,$3)", [actorId || null, row.id, JSON.stringify({ label })]);
      return NextResponse.json(row, { status: 201 });
    }
    if (body.action === "restore") {
      if (body.confirm !== "BƏRPA") return NextResponse.json({ error: "Bərpanı təsdiqləmək üçün BƏRPA yazın" }, { status: 400 });
      const [backup] = await sql.unsafe("select payload from system_backups where id=$1", [body.backupId || ""]);
      if (!backup) return NextResponse.json({ error: "Ehtiyat nüsxə tapılmadı" }, { status: 404 });
      const payload = typeof backup.payload === "string" ? JSON.parse(backup.payload) : backup.payload;
      const recovery=await createSnapshot(sql);
      await sql.unsafe("insert into system_backups(label,payload,created_by) values($1,$2::text::jsonb,$3)",['Bərpadan əvvəl '+new Date().toISOString(),JSON.stringify(recovery),actorId]);
      await restoreSnapshot(sql,payload,actorId,body.backupId || "");
      return NextResponse.json({ ok: true,reauthenticate:true });
    }
    return NextResponse.json({ error: "Naməlum əməliyyat" }, { status: 400 });
  } catch (error: any) {
    console.error("system.post", error);void logSystemError("system.post", error);
    return NextResponse.json({ error: error?.message || "Sistem əməliyyatı alınmadı" }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export const GET=withAdminSession(handleGET);
export const POST=withAdminSession(handlePOST);
