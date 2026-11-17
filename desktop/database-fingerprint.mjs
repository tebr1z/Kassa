import {createHash} from 'node:crypto';
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
// Pure SQL fingerprint helper. Keep filesystem/runtime bootstrapping out of
// this module: it is shared by the server verifier and desktop transfer.
export async function databaseFingerprint(sql,{schema}={}){
 if(schema!==undefined&&!/^[a-z][a-z0-9_]*$/.test(schema))throw new Error('Yanlış ehtiyat sxemi.');
 const filter=schema?' and n.nspname=$1':'',parameters=schema?[schema]:[];
 const tables=await sql.unsafe("select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not like 'pg_%' and n.nspname<>'information_schema'"+filter+' order by n.nspname,c.relname',parameters);
 const result=[];
 for(const table of tables){
  const qualified=quote(table.schema)+'.'+quote(table.name),hash=createHash('sha256');let rows=0;
  const columns=await sql.unsafe("select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as required from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2 and a.attnum>0 and not a.attisdropped order by a.attnum",[table.schema,table.name]);
  hash.update(JSON.stringify(columns));
  for await(const batch of sql.unsafe("select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as fingerprint from "+qualified+' t order by fingerprint').cursor(1000))for(const row of batch){hash.update(row.fingerprint+'\n');rows++;}
  result.push({kind:'table',schema:table.schema,table:table.name,rows,sha256:hash.digest('hex')});
 }
 const sequences=await sql.unsafe("select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname not like 'pg_%' and n.nspname<>'information_schema'"+filter+' order by n.nspname,c.relname',parameters);
 for(const sequence of sequences){const [state]=await sql.unsafe('select last_value::text as last_value,is_called from '+quote(sequence.schema)+'.'+quote(sequence.name));result.push({kind:'sequence',schema:sequence.schema,table:sequence.name,rows:1,sha256:createHash('sha256').update(JSON.stringify(state)).digest('hex')});}
 return result;
}
