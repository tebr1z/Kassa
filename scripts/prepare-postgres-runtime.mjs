import {cp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {findPostgres} from '../desktop/local-database.mjs';
const installed=path.dirname(await findPostgres());
const destination=path.resolve('desktop/vendor/postgres');
await mkdir(destination,{recursive:true});
await writeFile(path.join(destination,'PG_MAJOR'),path.basename(installed));
for(const name of ['bin','lib','share','server_license.txt','commandlinetools_3rd_party_licenses.txt','StackBuilder_3rd_party_licenses.txt'])await cp(path.join(installed,name),path.join(destination,name),{recursive:true});
// Ship the MSVC runtime app-locally for machines without a PostgreSQL installation.
for(const name of ['vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll']){
  const source=path.join(process.env.SystemRoot||'C:\\Windows','System32',name);
  try{await access(source);await cp(source,path.join(destination,'bin',name));}catch{throw new Error('Microsoft runtime tapılmadı: '+name);}
}
await writeFile(path.join(destination,'BIRKASSA-RUNTIME.txt'),'PostgreSQL Windows runtime bundled with BirKassa.\nSource: https://www.postgresql.org/download/windows/\nLicense and third-party notices are included in this directory.\n');
const license=await readFile(path.join(destination,'server_license.txt'),'utf8');if(!license.includes('PostgreSQL License'))throw new Error('PostgreSQL lisenziyası tapılmadı.');
console.log('PostgreSQL runtime prepared with licenses and app-local Microsoft runtime.');
