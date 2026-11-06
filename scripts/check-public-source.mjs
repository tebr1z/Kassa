import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {parse} from 'dotenv';
const staged=process.argv.includes('--staged');
const files=[...new Set(execFileSync('git',staged?['diff','--cached','--name-only','--diff-filter=ACMR','-z']:['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
const issues=[];
const knownSecrets=[];
for(const file of ['.env','.env.local','.env.production','.env.production.local']){
 try{for(const [key,value] of Object.entries(parse(await readFile(file,'utf8'))))if(/(?:DATABASE_URL|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)$/.test(key)&&value.length>=12){knownSecrets.push(value);if(key==='DATABASE_URL'){try{const password=decodeURIComponent(new URL(value).password);if(password.length>=12)knownSecrets.push(password);}catch{}}}}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
try{const setup=(await readFile('.private/web-admin-setup-token.txt','utf8')).trim();if(setup.length>=12)knownSecrets.push(setup);}catch(error){if(error.code!=='ENOENT')throw error;}
const forbidden=/(^|\/)(?:\.env(?:\..*)?|\.private|\.local-data|\.local-desktop-data|\.public-media|\.vercel|node_modules|outputs|work|web-release|desktop-release)(?:\/|$)|(?:\.birkassa|\.dump|\.sqlite3?|\.db|\.pem|\.key)$/i;
const patterns=[
 ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
 ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['service key',/\b(?:sk-proj-[A-Za-z0-9_-]{30,}|sk_live_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/],
 ['database credential',/postgres(?:ql)?:\/\/[^\s:'"`]+:[^\s@'"`]+@(?!localhost\b|127\.0\.0\.1\b|HOST\b|\$\{)[^\s'"`]+/i],
 ];
for(const file of files){
 if(file==='scripts/check-public-source.mjs'||file.endsWith('.tsbuildinfo'))continue;
 if(forbidden.test(file)){issues.push({file,reason:'private/runtime file'});continue;}
 if(!/\.(?:[cm]?[jt]sx?|json|sql|md|txt|ya?ml|example)$/.test(file))continue;
 const contents=staged?execFileSync('git',['show',':'+file],{encoding:'utf8',maxBuffer:10*1024*1024}):await readFile(file,'utf8');
 for(const [index,line] of contents.split(/\r?\n/).entries()){
  for(const [reason,pattern] of patterns)if(pattern.test(line))issues.push({file,line:index+1,reason});
  if(knownSecrets.some(secret=>line.includes(secret)))issues.push({file,line:index+1,reason:'known local secret (value redacted)'});
 }
}
// Values are deliberately never printed, even when a problem is found.
if(issues.length){console.error(JSON.stringify(issues,null,2));process.exitCode=1;}else console.log('PASS: '+files.length+' '+(staged?'staged':'source')+' files checked; no private data paths or known credential patterns found. This is a targeted check, not a guarantee.');
