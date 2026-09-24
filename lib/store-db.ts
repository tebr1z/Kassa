import postgres from "postgres";
export function storeDb() {
 if(!process.env.DATABASE_URL) throw new Error("Database unavailable");
 return postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:10});
}
