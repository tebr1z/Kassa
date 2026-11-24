import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Pure content checks: no browser, requests, storage or business database.
const source=await readFile('lib/storefront-about-translations.ts','utf8');
const compiled=ts.transpileModule(source,{fileName:'lib/storefront-about-translations.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[]);
const loaded={exports:{}};
runInNewContext(compiled.outputText,{module:loaded,exports:loaded.exports},{timeout:1000});
const {localizeStorefrontAbout}=loaded.exports;
const ast=ts.createSourceFile('storefront-about-translations.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let known;
function visit(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='publishedAboutAz'&&node.initializer&&ts.isNoSubstitutionTemplateLiteral(node.initializer))known=node.initializer.text;
  ts.forEachChild(node,visit);
}
visit(ast);
assert.equal(typeof known,'string');
// SHA-256 of the approved local publication payload; CI needs no deployment artifacts.
assert.equal(createHash('sha256').update(known).digest('hex'),'b8199e674627313d184275f8dabea849e94ab046bb34fe5fff8325b533cdeb70','Source must match the complete published merchant copy');
assert.equal(localizeStorefrontAbout(known,'az'),known,'Azerbaijani copy is retained exactly');
const normalizedVariant=` \r\n${known.replaceAll('\n\n','\r\n \t\r\n').replaceAll(' — ','  —\t')}\r\n `;
assert.equal(localizeStorefrontAbout(normalizedVariant,'az'),normalizedVariant,'Azerbaijani whitespace is never rewritten');
const firstLines={ru:'RestaMarket — место, где',en:'RestaMarket — a place',tr:'RestaMarket — mutfağınıza',zh:'RestaMarket——为您的厨房'};
const outputs=new Set([known]);
for(const language of ['ru','en','tr','zh']){
  const translated=localizeStorefrontAbout(known,language);
  assert.ok(translated.startsWith(firstLines[language]),`${language} has its own translation`);
  assert.equal(translated.split('\n\n').length,5,`${language} retains all five paragraphs`);
  assert.ok(translated.includes('RestaMarket')&&translated.includes('WhatsApp')&&translated.includes('Abşeron Mall'),`${language} retains merchant identity and contact details`);
  assert.ok(!translated.includes('mətbəxinizə')&&!translated.includes('undefined'));
  assert.equal(localizeStorefrontAbout(normalizedVariant,language),translated,'Only harmless source whitespace differences are normalized');
  assert.equal(localizeStorefrontAbout(known.replaceAll('\n',' '),language),translated,'Paragraph whitespace does not invalidate the known copy');
  outputs.add(translated);
}
assert.equal(outputs.size,5,'All five languages have distinct full copy');
for(const language of ['az','ru','en','tr','zh']){
  for(const custom of ['', '   ', 'Merchant-written about text.', `${known}\nA new merchant sentence.`, known.replace('RestaMarket —','Another brand —'), '<b>Custom text</b>']){
    assert.equal(localizeStorefrontAbout(custom,language),custom,'Empty, edited and custom merchant content is retained exactly');
  }
}
assert.equal(localizeStorefrontAbout(known,'unsupported'),known,'Unexpected runtime language fails back to the original copy');
console.log('PASS: five-language approved About copy, exact published-source match, harmless whitespace normalization, custom content preserved and SSR-safe pure evaluation; no network or business data used.');

