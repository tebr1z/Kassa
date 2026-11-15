// Dry fixture configuration and rollback tests; no Apache/service command runs.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {planVhost,staticFeedBlock,setupHost} from './setup-desktop-update-host.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'restamarket-update-host-test-'));
const original='# Existing unrelated header\nHeader always set X-Frame-Options SAMEORIGIN\nProxyPreserveHost On\nProxyPass / http://127.0.0.1:5782/ retry=0\nProxyPassReverse / http://127.0.0.1:5782/\n';
const modules=['proxy_module','alias_module','authz_core_module','headers_module','env_module','mime_module','ssl_module'].join('\n');
async function fixture(name,initial=original){const directory=path.join(root,name);const conf=path.join(directory,'conf');await mkdir(conf,{recursive:true});for(const file of ['vhost.conf','vhost_ssl.conf'])await writeFile(path.join(conf,file),initial);return {confDirectory:conf,publicRoot:path.join(directory,'public'),backupRoot:path.join(directory,'backups'),stamp:'20261115T120000000Z'};}
const calls=[];const runner=(file,args)=>{if(args[0]==='-M')assert.equal(file,'/usr/sbin/httpd','AlmaLinux apachectl does not support -M');calls.push(args.join(' '));return args[0]==='-M'?modules:'';};
try {
 const plan=planVhost(original);assert.equal(plan.backend,'http://127.0.0.1:5782/');assert.equal(plan.changed,true);assert.equal(planVhost(plan.planned).changed,false);assert.equal(plan.planned.replace(staticFeedBlock(),''),original);
 assert.ok(plan.planned.indexOf('ProxyPass "/desktop-updates/" "!"')<plan.planned.indexOf('ProxyPass / http://127.0.0.1:5782/'));
 for(const directive of ['Options None','AllowOverride None','AllowOverrideList None','DirectoryIndex disabled','SetHandler default-handler','Require all denied','Require method GET HEAD','Require ssl','SetEnv no-gzip 1','SetEnv no-brotli 1','no-cache, no-store, must-revalidate','nosniff','Content-Disposition "attachment"'])assert.ok(plan.planned.includes(directive),directive);
 for(const bad of [original.replace('127.0.0.1','10.0.0.5'),original.replace('ProxyPassReverse /','ProxyPassReverse /other'),original+original,'<Location />\nProxyPass http://127.0.0.1:5782/\n</Location>\n',original+'Alias /desktop-updates/ /unsafe/\n',plan.planned.replace('Options None','Options Indexes'),original.replace('ProxyPass /','ProxyPassMatch /')])assert.throws(()=>planVhost(bad));
 const dry=await fixture('dry');const result=await setupHost({...dry,run:runner});assert.equal(result.dryRun,true);assert.deepEqual(calls,['configtest','-M']);assert.equal(await readFile(path.join(dry.confDirectory,'vhost.conf'),'utf8'),original);await assert.rejects(readdir(dry.backupRoot),{code:'ENOENT'});
 const good=await fixture('good');calls.length=0;const applied=await setupHost({...good,run:runner,apply:true});assert.deepEqual(calls,['configtest','-M','configtest','reload httpd']);assert.equal(await readFile(path.join(good.confDirectory,'vhost.conf'),'utf8'),plan.planned);assert.equal(await readFile(path.join(applied.backup,'vhost.conf'),'utf8'),original);assert.equal(JSON.parse(await readFile(path.join(applied.backup,'receipt.json'),'utf8')).phase,'active');
 const noChange=await setupHost({...good,run:runner,apply:true});assert.deepEqual(noChange.changedFiles,[]);
 for(const failure of ['configtest','reload']) {
  const item=await fixture('failure-'+failure);let configChecks=0,failed=false;const attempted=[];
  const run=(_file,args)=>{attempted.push(args.join(' '));if(args[0]==='-M')return modules;if(args[0]==='configtest')configChecks++;if(!failed&&((failure==='configtest'&&configChecks===2)||(failure==='reload'&&args[0]==='reload'))){failed=true;throw Error('simulated '+failure+' failure');}return '';};
  await assert.rejects(setupHost({...item,run,apply:true}),/original vhost configurations restored and validated/);for(const file of ['vhost.conf','vhost_ssl.conf'])assert.equal(await readFile(path.join(item.confDirectory,file),'utf8'),original);assert.ok(attempted.filter(value=>value==='configtest').length>=3);assert.equal(attempted.at(-1),'reload httpd');
  const [backup]=await readdir(item.backupRoot);assert.equal(JSON.parse(await readFile(path.join(item.backupRoot,backup,'receipt.json'),'utf8')).phase,'rolled_back');
 }
 const missing=await fixture('missing-module');await assert.rejects(setupHost({...missing,run:(_file,args)=>args[0]==='-M'?'proxy_module':'',apply:true}),/module/);assert.equal(await readFile(path.join(missing.confDirectory,'vhost.conf'),'utf8'),original);await assert.rejects(readdir(missing.backupRoot),{code:'ENOENT'});
 const mismatch=await fixture('mismatch');await writeFile(path.join(mismatch.confDirectory,'vhost_ssl.conf'),original.replaceAll('5782','5784'));await assert.rejects(setupHost({...mismatch,run:runner,apply:true}),/different applications/);
 console.log('PASS: isolated Apache feed plans preserve proxy bytes and unrelated directives, exception ordering, HTTPS-only/static/allowlist/cache/compression guards, idempotence, no-write dry run, required-module gating, private backup receipts and configtest/reload rollback. No real Apache, service, host, DB or credentials used.');
} finally {
 const resolved=path.resolve(root);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('restamarket-update-host-test-'))throw Error('Refusing unexpected fixture cleanup target.');await rm(resolved,{recursive:true,force:true});
}
