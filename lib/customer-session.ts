import "server-only";
import {cookies} from "next/headers";
import {createHash} from "node:crypto";
import {storeDb} from "./store-db";
export const customerCookie="birkassa_customer";
export async function customerAccount(){
 const token=(await cookies()).get(customerCookie)?.value;if(!token)return null;
 const sql=storeDb();try{const [a]=await sql.unsafe("select a.id,a.customer_id,a.email,c.full_name,c.phone from customer_sessions s join customer_accounts a on a.id=s.account_id join customers c on c.id=a.customer_id where s.token_hash=$1 and s.expires_at>now()",[createHash("sha256").update(token).digest("hex")]);return a||null}finally{await sql.end()}
}
