import 'server-only';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type postgres from 'postgres';
import {z} from 'zod';

type Sql=ReturnType<typeof postgres>|postgres.TransactionSql;
export const salesPeriodKey='sales_reporting_period_v1';
const periodSchema=z.object({version:z.literal(1),startedAt:z.string().datetime(),resetId:z.string().uuid()});
export type SalesPeriod={startedAt:string|null;resetId:string|null};
export const salesPeriodResetSchema=z.object({
 confirm:z.literal('YENİ DÖVR'),reason:z.string().trim().min(3).max(500).refine(value=>!/[\x00-\x1f\x7f]/.test(value)),
 preview:z.string().min(50).max(200),
 backup:z.object({fileName:z.string().regex(/^[^\\/:*?"<>|\x00-\x1f]{1,180}\.birkassa$/i),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive().max(5*1024*1024*1024)}).strict(),
}).strict();
export type SalesPeriodReset=z.infer<typeof salesPeriodResetSchema>;
const periodError=(message:string,statusCode=409)=>Object.assign(new Error(message),{statusCode});

export async function readSalesPeriod(sql:Sql):Promise<SalesPeriod>{
 const [row]=await sql.unsafe('select value from system_settings where key=$1',[salesPeriodKey]);
 if(!row)return {startedAt:null,resetId:null};
 let parsed:unknown;try{parsed=JSON.parse(row.value);}catch{throw periodError('Satış dövrü ayarı zədələnib. Məlumatlar dəyişdirilmədi.');}
 const result=periodSchema.safeParse(parsed);if(!result.success)throw periodError('Satış dövrü ayarı uyğun deyil. Məlumatlar dəyişdirilmədi.');
 return {startedAt:result.data.startedAt,resetId:result.data.resetId};
}

export function salesPeriodMetadata(period:SalesPeriod,scope:'current'|'all'='current'){
 return {...period,scope,stockPreserved:true,financialExpensesPreserved:true,receiptsPreserved:true};
}

// The timestamp is decoded by our schema, never taken from a request parameter.
// Keep stock, payment guards and shift cash arithmetic completely outside this filter.
export function salesPeriodPredicate(period:SalesPeriod,scope:'current'|'all'='current',alias='s'){
 if(!/^[a-z][a-z0-9_]*$/i.test(alias))throw Error('Invalid sales table alias');
 if(scope==='all'||!period.startedAt)return 'true';
 const startedAt=z.string().datetime().parse(period.startedAt);
 return `${alias}.created_at >= '${startedAt}'::timestamptz`;
}

function previewSecret(secret:string){if(secret.length<32)throw periodError('Masaüstü təhlükəsizlik açarı hazır deyil.',503);return secret;}
function signature(secret:string,time:string,fingerprint:string){return createHmac('sha256',previewSecret(secret)).update(time+'\n'+fingerprint).digest('hex');}
function same(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}

async function snapshot(sql:Sql){
 const currentPeriod=await readSalesPeriod(sql),where=salesPeriodPredicate(currentPeriod);
 const [sales]=await sql.unsafe(`select count(*) filter(where ${where})::int as receipts,
  count(*) filter(where ${where} and s.status='completed')::int as completed,
  count(*) filter(where ${where} and s.status='returned')::int as returned,
  coalesce(sum(s.total) filter(where ${where} and s.status='completed'),0)::text as total,
  count(*) filter(where not (${where}))::int as archived,
  md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by s.id),'')) as digest from sales s`);
 const [shifts]=await sql.unsafe(`select count(*) filter(where closed_at is null)::int as open_count,
  md5(coalesce(string_agg(md5(row_to_json(cs)::text),'' order by cs.id),'')) as digest from cashier_shifts cs`);
 const fingerprint=createHash('sha256').update(JSON.stringify({currentPeriod,sales:sales.digest,shifts:shifts.digest})).digest('hex');
 return {currentPeriod,sales:{receipts:Number(sales.receipts),completed:Number(sales.completed),returned:Number(sales.returned),total:Number(sales.total)},openShiftCount:Number(shifts.open_count),archive:{receipts:Number(sales.archived)},fingerprint};
}

export async function previewSalesPeriod(sql:Sql,secret:string){
 const state=await snapshot(sql),time=Date.now().toString(36),{fingerprint,...preview}=state;
 return {...preview,preview:time+'.'+signature(secret,time,fingerprint),serverTime:new Date().toISOString()};
}

export async function resetSalesPeriod(sql:ReturnType<typeof postgres>,actorId:string,raw:unknown,secret:string){
 const parsed=salesPeriodResetSchema.safeParse(raw);if(!parsed.success)throw periodError('Dövr, səbəb, təsdiq və yoxlanılmış ehtiyat nüsxəni düzgün seçin.',400);
 const body=parsed.data;previewSecret(secret);
 return sql.begin(async tx=>{
  await tx.unsafe("set local lock_timeout='5s'");
  await tx.unsafe("select pg_advisory_xact_lock(hashtext('birkassa.sales-period'))");
  // Sales lock their open shift before posting. Lock shifts first, then receipts,
  // so a sale or shift close cannot straddle this reporting boundary.
  await tx.unsafe('lock table cashier_shifts,sales in share row exclusive mode');
  const [actor]=await tx.unsafe("select id from users where id=$1 and role='admin' and is_active=true for share",[actorId]);
  if(!actor)throw periodError('Yalnız baş rəhbər satış dövrünü dəyişə bilər.',403);
  const state=await snapshot(tx),parts=body.preview.split('.'),issuedAt=parseInt(parts[0],36);
  if(parts.length!==2||!Number.isFinite(issuedAt)||issuedAt>Date.now()+30000||Date.now()-issuedAt>15*60*1000||!same(parts[1],signature(secret,parts[0],state.fingerprint)))throw periodError('Satış və ya növbə məlumatları dəyişib. Yenidən baxın və yeni ehtiyat nüsxə yaradın.');
  if(state.openShiftCount)throw periodError('Əvvəl bütün açıq kassa növbələrini bağlayın.');
  if(!state.sales.receipts)throw periodError('Cari dövrdə sıfırlanacaq satış yoxdur.');
  const [{started_at:startedAt}]=await tx.unsafe("select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as started_at");
  const currentPeriod={startedAt:String(startedAt),resetId:randomUUID()};
  await tx.unsafe('insert into system_settings(key,value,updated_by,updated_at) values($1,$2,$3,clock_timestamp()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at',[salesPeriodKey,JSON.stringify({version:1,...currentPeriod}),actor.id]);
  await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,before_json,after_json) values($1,'sales.period_reset','sales_period',$2,$3,$4)",[actor.id,currentPeriod.resetId,JSON.stringify({currentPeriod:state.currentPeriod,sales:state.sales}),JSON.stringify({currentPeriod,reason:body.reason,backup:body.backup,stockPreserved:true,financialExpensesPreserved:true,receiptsPreserved:true})]);
  return {ok:true,currentPeriod,archivedReceipts:state.sales.receipts,backup:body.backup};
 });
}
