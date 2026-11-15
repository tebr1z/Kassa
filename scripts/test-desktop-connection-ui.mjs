// Source-level regressions for the explicit connection workflow. No real
// desktop profile, credentials, application server or network is used.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const panelFile='app/admin/desktop-panel.tsx',webFile='app/admin/web-settings.tsx';
const panel=await readFile(panelFile,'utf8'),web=await readFile(webFile,'utf8');
const panelTree=ts.createSourceFile(panelFile,panel,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const webTree=ts.createSourceFile(webFile,web,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function nodes(root,predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(root);return result;}
function namedFunction(name){const node=nodes(panelTree,node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)[0];assert.ok(node,`Missing ${name}`);return node;}

assert.ok(nodes(webTree,node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='./desktop-panel'&&node.importClause?.namedBindings?.getText(webTree).includes('DesktopConnection')).length,'Web settings must import the connection controls');
assert.ok(nodes(webTree,node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(webTree)==='DesktopConnection').length,'Web settings must render the connection controls, not leave them unreachable');
assert.match(web,/tab==='desktop'/,'The connection controls have a dedicated tab');

for(const name of ['DesktopConnection','DesktopStatus']){
 const component=namedFunction(name);
 const effects=nodes(component,node=>ts.isCallExpression(node)&&node.expression.getText(panelTree)==='useEffect');
 assert.ok(effects.length,`${name} needs status refresh`);
 for(const effect of effects){
  const effectText=effect.arguments[0].getText(panelTree);
  assert.doesNotMatch(effectText,/method\s*:\s*['"]POST['"]|\bact\s*\(|rotate-catalog|action\s*:\s*['"]sync['"]/,'Mount/status refresh must never publish or rotate credentials');
  assert.match(effectText,/30000/,'Status refresh remains live every 30 seconds');
 }
}
const connection=namedFunction('DesktopConnection').getText(panelTree);
assert.match(connection,/state\.configured&&state\.mode==='catalog'/,'Only a configured catalogue connection enables catalogue sync');
assert.match(connection,/disabled=\{!!busy\|\|!catalogue\}/,'Publishing control is disabled without a catalogue key');
assert.match(connection,/onClick=\{\(\)=>void act\('sync'\)\}/,'Manual sync must be an explicit button action');
assert.match(connection,/sync\?"\/api\/desktop-inbox":"\/api\/desktop-link"/,'Manual sync uses the protected existing API');
assert.match(connection,/if\(!urlEdited\.current\)setUrl/,'Read-only polling must not replace a typed shop URL');
assert.match(connection,/statusRequest\.current\?\.abort\(\)/,'Superseded status requests must be cancelled');
assert.match(connection,/pending\.current=true/,'Prevent duplicate connection/key operations');
assert.doesNotMatch(connection,/localStorage|sessionStorage/,'Connection credentials must not be copied into browser storage');
assert.match(panel,/fetch\("\/api\/desktop-link",\{cache:"no-store",signal\}\)/,'Status reads must not be served from cache');

const translationFile='lib/local-stock-ui-translations.ts',source=await readFile(translationFile,'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sandbox={exports:{}};vm.runInNewContext(javascript,sandbox,{filename:translationFile});
const rows=sandbox.exports.localStockUiTranslations;
const addedKeys=[
 'Vebə yalnız məhsul adı, şəkillər, ölçü, rəng, satış qiyməti və sifariş statusları ötürülür. Stok, alış qiyməti və maliyyə kompüterdə qalır.',
 'Şəkil və ölçüləri sayta göndərmək üçün əvvəlcə vebdə kataloq bağlantısı yaradın və açarı burada daxil edin.',
 'Bu açar yalnız sifarişləri alır; şəkil və ölçülər sayta göndərilmir. Vebdə kataloq bağlantısı yaradın və yeni açarla qoşulun.',
 'Hələ təsdiqlənməyib',
 'Son göndərmə təsdiqlənib. Yeni dəyişikliklərin vəziyyəti avtomatik yenilənir.',
 'Bağlantı vəziyyəti hər 30 saniyədə yenilənir.',
 'Sinxronizasiya yoxlanılır…','İndi sinxronlaşdır',
 'Sinxronizasiya yoxlandı. Son vəziyyəti aşağıda yoxlayın.',
 'Şəkillərin endirilməsi tamamlandı.','Endirilməyən şəkillər',
 'Vebdə: Tənzimləmələr → Masaüstü bağlantısı → Kataloq bağlantısı yarat. Sonra mağaza ünvanını və açarı burada yazın.',
 'Şəkil, ölçü və rəng üçün “Kataloq bağlantısı yarat” seçin. “Yalnız sifariş açarı” məhsul dəyişikliklərini göndərmir.',
 'İlk bağlantı mövcud kataloqu yenidən yazmır. Bundan sonra EXE-də saxlanan dəyişikliklər sayta göndərilir.',
];
for(const key of addedKeys){const row=rows.find(row=>row[0]===key);assert.ok(row,`Missing connection translation: ${key}`);assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()),'Connection UI needs all AZ/RU/EN/TR/ZH translations');}
console.log('PASS: web connection controls reachable; explicit-only key/publication actions, read-only status refresh, local warnings and five-language copy.');
