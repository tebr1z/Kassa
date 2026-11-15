// Static Apache feed setup only. This helper does not load application .env,
// database modules, private signing keys, systemd units or web release state.
import {readFile,writeFile,lstat,mkdir,open,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {noSymbolicLinks} from './init-desktop-update-key.mjs';

const HOST='kassa.nex.autos';
const CONF='/var/www/vhosts/system/'+HOST+'/conf';
const PUBLIC_ROOT='/opt/restamarket/desktop-updates';
const BACKUPS='/var/backups/restamarket';
const FILES=['vhost.conf','vhost_ssl.conf'];
const BEGIN='# BEGIN RESTAMARKET DESKTOP UPDATE HOST v1';
const END='# END RESTAMARKET DESKTOP UPDATE HOST v1';
const VERSION=String.raw`(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)`;

// References for the reviewed directives:
// https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#orderingproxypassdirectives
// https://httpd.apache.org/docs/2.4/mod/core.html#allowoverride
// https://httpd.apache.org/docs/2.4/mod/mod_authz_core.html#reqmethod
// https://httpd.apache.org/docs/2.4/mod/mod_ssl.html#requiressl
// https://httpd.apache.org/docs/2.4/env.html#special
// https://httpd.apache.org/docs/2.4/mod/mod_brotli.html
export function staticFeedBlock() {
 return `${BEGIN}
# This exception MUST precede the existing same-context catch-all ProxyPass.
ProxyPass "/desktop-updates/" "!"
Alias "/desktop-updates/" "${PUBLIC_ROOT}/"
<Directory "${PUBLIC_ROOT}">
    Options None
    AllowOverride None
    AllowOverrideList None
    DirectoryIndex disabled
    SetHandler default-handler
    ForceType application/octet-stream
    Require all denied
    SetEnv no-gzip 1
    SetEnv no-brotli 1
    RemoveOutputFilter json exe
    Header unset Cache-Control
    Header always set Cache-Control "no-store"
    Header always unset Set-Cookie
    Header always set X-Content-Type-Options "nosniff"
    Header always set Content-Security-Policy "default-src 'none'; sandbox"
    Header always set Referrer-Policy "no-referrer"
    <FilesMatch "^(?:(?:latest|manifest)\\.json|RestaMarket-Setup-${VERSION}\\.exe)$">
        <RequireAll>
            Require all granted
            Require method GET HEAD
            Require ssl
        </RequireAll>
    </FilesMatch>
    <FilesMatch "\\.json$">
        ForceType application/json
        Header always set Cache-Control "public, max-age=31536000, immutable" "expr=%{REQUEST_STATUS} == 200 || %{REQUEST_STATUS} == 206"
    </FilesMatch>
    <FilesMatch "\\.exe$">
        ForceType application/octet-stream
        Header always set Content-Disposition "attachment"
        Header always set Cache-Control "public, max-age=31536000, immutable" "expr=%{REQUEST_STATUS} == 200 || %{REQUEST_STATUS} == 206"
    </FilesMatch>
    <Files "latest.json">
        Header always set Cache-Control "no-cache, no-store, must-revalidate"
        Header always set Pragma "no-cache"
        Header always set Expires "0"
    </Files>
</Directory>
# Only exact stable-feed shapes are readable, including during staging rename.
<LocationMatch "^/desktop-updates/(?!win-x64/stable/(?:latest\\.json|${VERSION}/(?:manifest\\.json|RestaMarket-Setup-${VERSION}\\.exe))$)">
    Require all denied
</LocationMatch>
${END}
`;
}

export function planVhost(original) {
 if(typeof original!=='string'||original.length>512*1024||original.includes('\0'))throw Error('Unexpected custom vhost configuration.');
 const block=staticFeedBlock();let clean=original,already=false;
 if(original.includes(BEGIN)||original.includes(END)) {
  if(original.split(BEGIN).length!==2||original.split(END).length!==2||!original.includes(block))throw Error('Existing managed static-feed block differs; review it manually.');
  clean=original.replace(block,'');already=true;
 }
 if(/desktop-updates/i.test(clean))throw Error('An unmanaged desktop update route already exists.');
 if(/^\s*ProxyPassMatch\b/im.test(clean)||/<\s*Location(?:Match)?\b/i.test(clean))throw Error('Location/ProxyPassMatch routing needs a separate manual review.');
 const forwards=[...clean.matchAll(/^([ \t]*)ProxyPass[ \t]+(?:"\/"|\/)[ \t]+"?(http:\/\/127\.0\.0\.1:([0-9]{4,5})\/)"?(?:[ \t]+[^\r\n]*)?\r?$/gm)];
 const reverses=[...clean.matchAll(/^[ \t]*ProxyPassReverse[ \t]+(?:"\/"|\/)[ \t]+"?(http:\/\/127\.0\.0\.1:[0-9]{4,5}\/)"?[ \t]*\r?$/gm)];
 if(forwards.length!==1||reverses.length!==1||forwards[0][2]!==reverses[0][1]||Number(forwards[0][3])<1024||Number(forwards[0][3])>65535)throw Error('Expected exactly one matching loopback catch-all proxy and reverse proxy.');
 // Reject proxy directives nested in containers: their ordering differs.
 const stack=[];for(const line of clean.split(/\r?\n/)) {
  if(/^\s*#/.test(line))continue;
  const close=line.match(/^\s*<\/(\w+)\s*>\s*$/);if(close){if(stack.pop()?.toLowerCase()!==close[1].toLowerCase())throw Error('Unexpected custom vhost section nesting.');continue;}
  if(/^\s*ProxyPass\b/i.test(line)&&stack.some(section=>!['ifmodule','ifdefine'].includes(section.toLowerCase())))throw Error('Proxy routing is not in the expected server context.');
  const start=line.match(/^\s*<(\w+)\b[^>]*>\s*$/);if(start)stack.push(start[1]);
 }
 if(stack.length)throw Error('Unexpected unclosed custom vhost section.');
 const first=clean.search(/^[ \t]*ProxyPass\b/m);if(first<0)throw Error('Missing proxy insertion point.');
 const planned=clean.slice(0,first)+block+clean.slice(first);
 if(already&&planned!==original)throw Error('Existing static-feed block is not at the reviewed insertion point.');
 return {original,planned,backend:forwards[0][2],changed:planned!==original};
}

const digest=value=>createHash('sha256').update(value).digest('hex');
async function regularFile(file,production) {
 await noSymbolicLinks(file);const item=await lstat(file);if(!item.isFile()||item.size>512*1024)throw Error('Vhost must be a bounded regular file.');
 if(production&&(item.uid!==0||(item.mode&0o022)!==0))throw Error('Vhost file must be root-owned and not writable by other accounts.');return item;
}
async function checkedDirectory(directory,{production=false,privateMode=false,create=false}={}) {
 await noSymbolicLinks(directory,{missing:create});let existed=true;try{await lstat(directory);}catch(error){if(error.code!=='ENOENT')throw error;existed=false;}
 if(create){await mkdir(directory,{recursive:true,mode:privateMode?0o700:0o755});if(!existed)await chmod(directory,privateMode?0o700:0o755);}
 const item=await lstat(directory);if(!item.isDirectory())throw Error('Expected a real directory.');
 if(production&&(item.uid!==0||(item.mode&(privateMode?0o077:0o022))!==0))throw Error('Host update directory ownership/permissions need review.');
 if(production&&!privateMode&&(item.mode&0o005)!==0o005)throw Error('The public static directory must be readable/traversable by Apache.');
}
async function save(file,bytes,{exclusive=false,mode=0o600}={}) {await writeFile(file,bytes,{flag:exclusive?'wx':'r+',mode});const handle=await open(file,'r+');try{await handle.truncate(Buffer.byteLength(bytes));await handle.sync();}finally{await handle.close();}}
const execute=(file,args)=>{try{return execFileSync(file,args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:1024*1024});}catch(error){throw Error('Reviewed Apache command failed: '+file+' '+args.join(' ')+' (exit '+(error.status??error.code??'unknown')+'). Inspect its root-only diagnostics.');}};

// Injectable paths/commands are for isolated filesystem/rollback tests only.
// The CLI fixes the production host, public root, backup root and commands.
export async function setupHost({confDirectory=CONF,publicRoot=PUBLIC_ROOT,backupRoot=BACKUPS,run=execute,apply=false,production=false,stamp=new Date().toISOString().replace(/[-:.]/g,'')}={}) {
 if(!/^[0-9]{8}T[0-9]{9}Z$/.test(stamp))throw Error('Unexpected backup timestamp.');
 const records=[];for(const name of FILES){const file=path.join(confDirectory,name);await regularFile(file,production);records.push({name,file,...planVhost(await readFile(file,'utf8'))});}
 if(records[0].backend!==records[1].backend)throw Error('HTTP and HTTPS proxies point at different applications; manual review is required.');
 run('/usr/sbin/apachectl',['configtest']);
 const modules=run('/usr/sbin/httpd',['-M']);for(const moduleName of ['proxy_module','alias_module','authz_core_module','headers_module','env_module','mime_module','ssl_module'])if(!new RegExp('\\b'+moduleName+'\\b').test(modules))throw Error('Required Apache module is unavailable: '+moduleName);
 const changes=records.filter(record=>record.changed);if(!apply||!changes.length)return {dryRun:!apply,changedFiles:changes.map(record=>record.name),backend:records[0].backend,publicRoot};
 await checkedDirectory(backupRoot,{production,privateMode:true,create:true});
 const backup=path.join(backupRoot,'desktop-updates-'+stamp);await noSymbolicLinks(backup,{missing:true});await mkdir(backup,{mode:0o700});
 for(const record of records)await save(path.join(backup,record.name),record.original,{exclusive:true});
 const receipt={schema:1,host:HOST,at:new Date().toISOString(),phase:'prepared',backend:records[0].backend,publicRoot,files:records.map(record=>({name:record.name,before:digest(record.original),after:digest(record.planned)}))};
 await save(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{exclusive:true});
 await checkedDirectory(publicRoot,{production,create:true});
 let touched=false;
 try {
  // Check both source files again before either is changed.
  for(const record of records){await regularFile(record.file,production);if(await readFile(record.file,'utf8')!==record.original)throw Error('Vhost changed since planning; no configuration is overwritten.');}
  for(const record of changes){touched=true;await save(record.file,record.planned);}
  run('/usr/sbin/apachectl',['configtest']);run('/usr/bin/systemctl',['reload','httpd']);
  receipt.phase='active';await save(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  return {changedFiles:changes.map(record=>record.name),backend:records[0].backend,publicRoot,backup};
 } catch(error) {
  if(!touched)throw Error(error.message+'; no vhost configuration was changed; backup retained at '+backup);
  try {
   // Never overwrite unrelated concurrent edits during recovery.
   for(const record of changes){await regularFile(record.file,production);const current=await readFile(record.file,'utf8');if(current!==record.planned&&current!==record.original)throw Error('Concurrent vhost edit prevents automatic recovery.');}
   for(const record of changes)await save(record.file,record.original);
   run('/usr/sbin/apachectl',['configtest']);run('/usr/bin/systemctl',['reload','httpd']);
   receipt.phase='rolled_back';await save(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  } catch(rollbackError) {throw Error(error.message+'; automatic Apache recovery failed: '+rollbackError.message+'; urgent review required; original configs are in '+backup);}
  throw Error(error.message+'; original vhost configurations restored and validated; backup retained at '+backup);
 }
}

async function main() {
 if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()!==0)throw Error('Run only as root on the selected Linux Apache hosting server.');
 if(process.argv.length!==3||!['--dry-run','--apply'].includes(process.argv[2]))throw Error('Usage: node scripts/setup-desktop-update-host.mjs --dry-run|--apply');
 console.log(JSON.stringify(await setupHost({apply:process.argv[2]==='--apply',production:true})));
 console.log('Only the two custom vhost files and root-owned static feed directory are in scope; database, application proxy target and web service are unchanged. Static feed access requires HTTPS.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error('Static feed host setup failed: '+error.message);process.exitCode=1;});
