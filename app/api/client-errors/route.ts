import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { message?: string; detail?: string };
    const message = String(body.message || "").trim();
    if (!message) return NextResponse.json({ error: "Xəta mətni boşdur" }, { status: 400 });
    await logSystemError("browser", Object.assign(new Error(message.slice(0, 500)), { stack: String(body.detail || "").slice(0, 4000) }));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("client-errors.post", error);
    return NextResponse.json({ error: "Xəta jurnalı yazılmadı" }, { status: 500 });
  }
}
