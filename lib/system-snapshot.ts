import "server-only";
import type postgres from "postgres";

type Sql=ReturnType<typeof postgres>;
type Row=Record<string,unknown>;
type Snapshot={version:2;createdAt:string;tables:Record<string,Row[]>};
const volatile=['auth_sessions','customer_sessions','staff_auth_attempts','customer_auth_attempts'];
const excluded=new Set(['__drizzle_migrations','system_backups',...volatile]);
const quoted=(name:string)=>'"'+name.replaceAll('"','""')+'"';

export async function snapshotTableOrder(sql:Sql|postgres.TransactionSql) {
  const names=(await sql.unsafe("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>String(r.tablename)).filter(name=>!excluded.has(name));
  const edges=await sql.unsafe("select c.relname child,p.relname parent from pg_constraint fk join pg_class c on c.oid=fk.conrelid join pg_class p on p.oid=fk.confrelid join pg_namespace n on n.oid=c.relnamespace where fk.contype='f' and n.nspname='public' and c.oid<>p.oid");
  const order:string[]=[],visiting=new Set<string>(),done=new Set<string>();
  const visit=(name:string)=>{if(done.has(name))return;if(visiting.has(name))throw new Error('Ehtiyat sxemində dövri asılılıq var. Tam SQL nüsxəsini istifadə edin.');visiting.add(name);for(const edge of edges)if(edge.child===name&&names.includes(edge.parent))visit(edge.parent);visiting.delete(name);done.add(name);order.push(name);};
  names.forEach(visit);return order;
}
export async function createSnapshot(sql:Sql):Promise<Snapshot> {
  return sql.begin(async tx=>{
    await tx.unsafe('set transaction isolation level repeatable read read only');
    const tables:Record<string,Row[]>={};
    for(const table of await snapshotTableOrder(tx))tables[table]=await tx.unsafe(`select * from ${quoted(table)}`);
    return {version:2,createdAt:new Date().toISOString(),tables};
  });
}
export async function restoreSnapshot(sql:Sql,payload:unknown,actorId:string|null,backupId:string) {
  const snapshot=payload as Partial<Snapshot>;
  if(snapshot?.version!==2||!snapshot.tables||typeof snapshot.tables!=='object')throw new Error('Köhnə ehtiyat nüsxə tam bərpanı dəstəkləmir. Tam SQL/.birkassa nüsxəsini istifadə edin.');
  return sql.begin(async tx=>{
    await tx.unsafe("select pg_advisory_xact_lock(hashtext('birkassa.system-restore'))");
    const order=await snapshotTableOrder(tx),data=snapshot.tables!;
    if(order.some(table=>!Array.isArray(data[table]))||Object.keys(data).some(table=>!order.includes(table)))throw new Error('Ehtiyat nüsxənin sxemi bu versiya ilə uyğun deyil. Baza dəyişdirilmədi.');
    // Lock all durable tables so concurrent sales cannot straddle a restore.
    await tx.unsafe('lock table '+order.map(quoted).join(',')+' in access exclusive mode');
    const sequences=await tx.unsafe("select schemaname,sequencename,last_value from pg_sequences where schemaname='public'");
    const [identity]=await tx.unsafe("select value from system_settings where key='desktop_sync_client_id'");
    for(const table of volatile)await tx.unsafe(`delete from ${quoted(table)}`);
    // Backup records are retained across restores, without dangling user references.
    await tx.unsafe('update system_backups set created_by=null');
    for(const table of [...order].reverse())await tx.unsafe(`delete from ${quoted(table)}`);
    for(const table of order)for(const row of data[table]){
      if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Ehtiyat nüsxə zədələnib.');
      const keys=Object.keys(row);if(!keys.length)throw new Error('Boş ehtiyat sətri.');
      // JSON rows are decoded by PostgreSQL using the actual target column types.
      await tx.unsafe(`insert into ${quoted(table)} (${keys.map(quoted).join(',')}) select ${keys.map(quoted).join(',')} from jsonb_populate_record(null::${quoted(table)},$1::text::jsonb)`,[JSON.stringify(row)]);
    }
    if(identity)await tx.unsafe("insert into system_settings(key,value) values('desktop_sync_client_id',$1) on conflict(key) do update set value=excluded.value",[identity.value]);
    // Restored queued snapshots describe the old point in time. The next poll
    // captures the restored inventory under a fresh, monotonically newer revision.
    await tx.unsafe('delete from desktop_sync_outbox');
    await tx.unsafe("delete from system_settings where key='desktop_catalog_digest'");
    // Never rewind a sequence: in particular, old sync revisions must stay old.
    for(const sequence of sequences){
      const columns=await tx.unsafe("select c.relname table_name,a.attname column_name from pg_depend d join pg_class c on c.oid=d.refobjid join pg_attribute a on a.attrelid=c.oid and a.attnum=d.refobjsubid where d.objid=$1::regclass and d.deptype in ('a','i')",['public.'+sequence.sequencename]);
      const column=columns[0];if(!column||!order.includes(column.table_name))continue;
      const [maximum]=await tx.unsafe(`select coalesce(max(${quoted(column.column_name)}),0)::text n from ${quoted(column.table_name)}`);
      const value=BigInt(maximum.n)>BigInt(sequence.last_value||0)?String(maximum.n):String(sequence.last_value||1);
      await tx.unsafe('select setval($1::regclass,$2::bigint,true)',['public.'+sequence.sequencename,value]);
    }
    const [actor]=actorId?await tx.unsafe('select id from users where id=$1',[actorId]):[];
    await tx.unsafe("insert into audit_logs(user_id,action,entity_type,entity_id,after_json) values($1,'system.restore','backup',$2,$3)",[actor?.id||null,backupId,JSON.stringify({version:2,restoredAt:new Date().toISOString()})]);
  });
}
