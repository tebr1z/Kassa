import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import postcss from 'postcss';
const require=createRequire(import.meta.url);
async function load(file){const result={exports:{}};new Function('require','module','exports',ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,result,result.exports);return result.exports;}
const paths=['app/admin/store/ticket-desk.tsx','app/admin/support-attention.tsx','app/api/store-admin/chat/route.ts'];
const source=Object.fromEntries(await Promise.all(paths.map(async file=>[file,await readFile(file,'utf8')])));
const languageSource=await readFile('lib/language.tsx','utf8');
const translated=new Set();
function rowsIn(file,code){const tree=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true);function scan(node){if(ts.isArrayLiteralExpression(node)&&node.elements.length===5&&node.elements.every(ts.isStringLiteral))translated.add(node.elements[0].text);ts.forEachChild(node,scan);}scan(tree);return tree;}
const languageTree=rowsIn('lib/language.tsx',languageSource);
for(const statement of languageTree.statements)if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier)){
 const value=statement.moduleSpecifier.text;if(value.startsWith('./')&&value.includes('translations')&&!value.includes('support-translations')&&!value.includes('desktop-translations'))rowsIn(value,await readFile('lib/'+value.slice(2)+'.ts','utf8'));
}
for(const row of(await load('lib/desktop-translations.ts')).desktopTranslations)translated.add(row[0]);
const {supportTranslations}=await load('lib/support-translations.ts');
for(const row of supportTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));assert.equal(translated.has(row[0]),false,'New support key must not duplicate an existing dictionary row: '+row[0]);translated.add(row[0]);}
assert.match(languageSource,/import\s*\{supportTranslations\}\s*from ['"]\.\/support-translations['"]/);assert.ok(languageSource.includes('...supportTranslations'));
const required=new Set();
function values(node){if(ts.isStringLiteral(node))required.add(node.text);else if(ts.isConditionalExpression(node)){values(node.whenTrue);values(node.whenFalse);}else ts.forEachChild(node,values);}
for(const [file,code]of Object.entries(source)){
 const compiled=ts.transpileModule(code,{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext},reportDiagnostics:true});assert.deepEqual((compiled.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error),[],file+' must transpile');
 const tree=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true);
 function scan(node){
  if(ts.isCallExpression(node)&&['t','setError','setNotice'].includes(node.expression.getText(tree)))for(const arg of node.arguments)values(arg);
  if(ts.isNewExpression(node)&&['Error','TicketError'].includes(node.expression.getText(tree)))for(const arg of node.arguments||[])values(arg);
  if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='error')values(node.initializer);
  if(ts.isVariableDeclaration(node)&&['kinds','statuses'].includes(node.name.getText(tree))&&node.initializer&&ts.isObjectLiteralExpression(node.initializer))for(const property of node.initializer.properties)if(ts.isPropertyAssignment(property))values(property.initializer);
  if(ts.isArrayLiteralExpression(node)&&node.elements.length===2&&node.elements.every(ts.isStringLiteral))required.add(node.elements[1].text);
  ts.forEachChild(node,scan);
 }scan(tree);
}
for(const key of required)if(key)assert.ok(translated.has(key),'Missing support translation: '+key);
const api=source['app/api/store-admin/chat/route.ts'];
assert.match(api,/GET=withAdminSession\(handleGET\)/);assert.match(api,/POST=withAdminSession\(handlePOST\)/);
const getSource=api.slice(api.indexOf('async function handleGET'),api.indexOf('const reply='));assert.doesNotMatch(getSource,/update support_|insert into|delete from|notifyCustomerEmail/,'GET/list/detail/summary is read-only');assert.match(getSource,/isolation level repeatable read read only/);
assert.match(api,/staff_read_revision=greatest\(staff_read_revision,\$1::bigint\)/);assert.match(api,/BigInt\(b.customerRevision\)>BigInt\(ticket.customerRevision\)/);
assert.match(api,/notification\.email/);assert.match(api,/eventKey:'support-reply:'\+notification\.id/);assert.ok(api.indexOf('if(notification?.email)')>api.indexOf('return {id:String(message.id)'),'Notification is outside the reply transaction');assert.doesNotMatch(api,/console\.|logSystemError/,'Private ticket content/contacts are not logged');
const ui=source['app/admin/store/ticket-desk.tsx'];assert.match(ui,/void loadDetail\(id,true\)/,'An explicit open acknowledges the viewed revision');assert.match(ui,/customerRevision:data\.ticket\.customerRevision/);assert.match(ui,/const run=\+\+detailRun\.current/);assert.match(ui,/run!==detailRun\.current/);assert.match(ui,/if\(pending\.current\|\|!detail\)return/,'Double replies are guarded');assert.match(ui,/month:'2-digit'/,'Dates do not depend on missing month names in limited ICU');assert.match(ui,/Bağlı bileti yenidən aç/,'Reopening is not mislabeled as creating a customer ticket');
const dashboard=await readFile('app/admin/staff-dashboard.tsx','utf8'),commerce=await readFile('app/admin/store/commerce-manager.tsx','utf8');
assert.match(dashboard,/\["Dəstək biletləri", MessageSquare\]/);assert.match(dashboard,/useSupportAttention\(auth\?\.authenticated===true&&auth\.user\?\.role==='admin'\)/);assert.match(dashboard,/active==='Dəstək biletləri'&&auth\.user\.role==='admin'&&<TicketDesk/);assert.match(dashboard,/get\('section'\)!=='support'/);assert.doesNotMatch(commerce,/<TicketDesk|setTab\('messages'\)|\["messages","Dəstək biletləri"\]/);assert.match(commerce,/staffPortalPath\(\)\+'\?section=support'/);
const policy=await readFile('lib/staff-access.ts','utf8');assert.doesNotMatch(policy,/['"]\/api\/store-admin\/chat['"]\s*:/,'Existing admin-only API permission is not broadened to online/other staff');
const migration=await readFile('drizzle/0034_support_attention.sql','utf8');assert.match(migration,/AFTER INSERT OR UPDATE OF body/);assert.match(migration,/NEW\.sender='customer'/);assert.match(migration,/NEW\.body IS DISTINCT FROM OLD\.body/);assert.match(migration,/customer_revision=customer_revision\+1/);assert.match(migration,/SET DEFAULT clock_timestamp\(\)/);assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM|TRUNCATE|CREATE USER|password_hash/i);
const css=await readFile('app/admin/support-desk.css','utf8');postcss.parse(css);assert.match(css,/focus-visible/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/minmax\(0,1fr\)/);
console.log('PASS: support TSX/CSS, dedicated restricted navigation/title badges, snapshot-vs-explicit-read contract, async/double-submit guards, transactional/customer trigger contract, after-commit recipient privacy, and '+supportTranslations.length+' unique AZ/RU/EN/TR/ZH labels. Real SQL is separately covered by test-support-integration.mjs.');
