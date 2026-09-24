import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/log-error";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const connection=()=>{if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL təyin edilməyib");return postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10})};

export async function GET(){const sql=connection();try{const rows=await sql.unsafe("select id,name,phone,email,address from suppliers where is_active=true order by name");return NextResponse.json(rows)}catch(error){console.error("suppliers.get",error);void logSystemError("suppliers.get", error);return NextResponse.json({error:"Təchizatçılar yüklənmədi"},{status:500})}finally{await sql.end({timeout:2})}}

export async function POST(request:Request){const sql=connection();try{const body=await request.json() as {name?:string;phone?:string;email?:string;address?:string};const name=String(body.name||"").trim();if(name.length<2)return NextResponse.json({error:"Təchizatçı adını yazın"},{status:400});const [row]=await sql.unsafe("insert into suppliers (name,phone,email,address) values ($1,$2,$3,$4) returning id,name,phone,email,address",[name,body.phone||null,body.email||null,body.address||null]);return NextResponse.json(row,{status:201})}catch(error){console.error("suppliers.create",error);void logSystemError("suppliers.create", error);return NextResponse.json({error:"Təchizatçı saxlanmadı"},{status:500})}finally{await sql.end({timeout:2})}}
