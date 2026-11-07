import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Pure source/content checks: no server, database, customer data or provider calls.
async function load(file,imports={}){
 const source=await readFile(file,'utf8');
 const compiled=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const errors=(compiled.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error);
 assert.deepEqual(errors.map(item=>ts.flattenDiagnosticMessageText(item.messageText,' ')),[],file+' must transpile');
 const compiledModule={exports:{}};
 new Function('require','module','exports',compiled.outputText)(name=>{
  assert.ok(Object.hasOwn(imports,name),file+' has an unexpected runtime dependency: '+name);
  return imports[name];
 },compiledModule,compiledModule.exports);
 return compiledModule.exports;
}

const languages=['az','ru','en','tr','zh'];
const names={az:'termsAz',ru:'termsRu',en:'termsEn',tr:'termsTr',zh:'termsZh'};
const displayDates={az:'8 noyabr 2026',ru:'8 ноября 2026',en:'8 November 2026',tr:'8 Kasım 2026',zh:'2026年11月8日'};
const ids=[
 'magaza-elaqe','tetbiq-dairesi','mehsul-secimi','hesab-tehlukesizliyi',
 'sifaris-tesdiqi','qiymet-endirim','odenis-sened','tehvil-catdirilma',
 'qebul-yoxlama','legv-imtina','deyisdirme-qusur','ferdi-istehsal',
 'zemanet-istifade','melumat-mexfilik','sui-istifade-huquqlar',
 'mesuliyyet-deyisiklik','muraciet-mubahise',
];
const sourceUrls=[
 'https://frameworks.e-qanun.az/10/f_10406.html',
 'https://frameworks.e-qanun.az/9/f_9479.html',
 'https://frameworks.e-qanun.az/46/f_46944.html',
 'https://frameworks.e-qanun.az/3/f_3724.html',
 'https://frameworks.e-qanun.az/19/f_19675.html',
];
const modules=Object.fromEntries(await Promise.all(languages.map(async language=>[language,await load('lib/terms-'+language+'.ts')])));
const imports=Object.fromEntries(languages.map(language=>['./terms-'+language,modules[language]]));
const {termsContent}=await load('lib/terms-content.ts',imports);
const {languageOptions,isLanguage}=await load('lib/language-options.ts');
assert.deepEqual(Object.keys(termsContent).sort(),[...languages].sort(),'All five languages must be registered, without fallback-only or extra entries');
assert.deepEqual(Object.keys(languageOptions).sort(),[...languages].sort(),'Terms languages match the real language selector');

const nonempty=(value,label)=>assert.ok(typeof value==='string'&&value.trim().length>0,label+' must be nonempty text');
const section=(document,id)=>{const found=document.sections.find(item=>item.id===id);assert.ok(found,id);return found;};
const textOf=part=>[part.title,...part.paragraphs||[],...part.bullets||[],...(part.subsections||[]).flatMap(textOf)].join('\n');
function checkPart(part,label){
 nonempty(part.title,label+' heading');
 assert.ok((part.paragraphs?.length||0)+(part.bullets?.length||0)>0,label+' must contain full text, not only a heading');
 for(const field of ['paragraphs','bullets']){
  if(part[field]===undefined)continue;
  assert.ok(Array.isArray(part[field]),label+' '+field);
  for(const [index,value]of part[field].entries()){
   nonempty(value,label+' '+field+' '+index);
   assert.ok(value.trim().length>=12,label+' '+field+' '+index+' cannot be a placeholder summary');
  }
 }
 for(const [index,child]of (part.subsections||[]).entries())checkPart(child,label+' subsection '+index);
}
function sameShape(actual,expected,label){
 for(const field of ['paragraphs','bullets','subsections'])assert.equal(actual[field]?.length,expected[field]?.length,label+' '+field+' must be fully translated');
 for(const [index,child]of (expected.subsections||[]).entries())sameShape(actual.subsections[index],child,label+' subsection '+index);
}

for(const language of languages){
 const document=termsContent[language];
 assert.equal(isLanguage(language),true);
 assert.strictEqual(document,modules[language][names[language]],language+' aggregator must register its actual complete translation');
 assert.equal(document.status,'published',language+' cannot remain a draft');
 assert.equal(document.version,'2026-11-08.1',language+' policy version');
 nonempty(document.title,language+' title');nonempty(document.updatedDate,language+' display date');
 assert.equal(document.updatedDate,displayDates[language],language+' deterministic release date');
 assert.match(document.updatedDate,/2026/,language+' display date must be author-provided');
 assert.equal(document.intro.length,2,language+' complete introduction');
 for(const value of document.intro)nonempty(value,language+' introduction');
 assert.deepEqual(document.sections.map(item=>item.id),ids,language+' stable ordered section anchors');
 for(const [index,item]of document.sections.entries()){
  checkPart(item,language+' '+item.id);
  sameShape(item,termsContent.az.sections[index],language+' '+item.id);
 }
 assert.deepEqual(document.sources.map(item=>item.href),sourceUrls,language+' five official source URLs');
 for(const source of document.sources)nonempty(source.label,language+' source label');
 const text=[document.title,document.notice||'',...document.intro,...document.sections.map(textOf)].join('\n');
 assert.ok(text.length>4000,language+' must contain the full policy, not a short translated summary');
 assert.doesNotMatch(text,/\b(?:TODO|TBD|FIXME|lorem ipsum|your company|insert here)\b|\[(?:INSERT|PLACEHOLDER)[^\]]*\]|\{\{[^}]+\}\}/iu,language+' cannot publish placeholders');
 assert.ok(!/(?<![\p{L}\p{N}])(?:VÖEN|VOEN|TIN|ИНН)(?![\p{L}\p{N}])|taxpayer identification|tax identification number|налоговый номер|vergi kimlik|税号|纳税人识别号/iu.test(text),language+' must not invent or publish an unprovided tax identifier');
 assert.doesNotMatch(text,/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,language+' cannot invent an unprovided seller email');
 const contact=section(document,'magaza-elaqe').paragraphs[0];
 assert.ok(contact.includes('RestaMarket')&&contact.includes('WhatsApp'),language+' approved public brand/contact');
 const phones=[...text.matchAll(/\+\d[\d ()-]{6,}\d/g)].map(match=>match[0].replace(/\D/g,''));
 assert.ok(phones.length>=2,language+' shop and enquiry sections must retain the approved telephone');
 assert.ok(phones.every(phone=>phone==='994702328080'),language+' must not invent another contact telephone');
 assert.match(contact,/Abşeron Mall/u,language+' retains the named shop location');
 for(const number of ['1','6','4'])assert.match(contact,new RegExp('(?:^|\\D)'+number+'(?:\\D|$)'),language+' retains row/building/shop '+number);
 const privacy=section(document,'melumat-mexfilik').paragraphs[1],deliveryTerms=section(document,'tehvil-catdirilma').paragraphs[1];
 for(const provider of ['Leaflet','OpenStreetMap','Nominatim','WhatsApp','Vexira'])assert.ok(privacy.includes(provider),language+' current map/media/notification disclosure: '+provider);
 assert.doesNotMatch(privacy,/Google|unpkg/iu,language+' cannot describe removed map/script providers');
 assert.doesNotMatch(deliveryTerms,/(?:^|\D)30(?:\D|$)/u,language+' legal tariff refers to current adjustable settings, not a hardcoded promotional threshold');
 assert.doesNotMatch(await readFile('lib/terms-'+language+'.ts','utf8'),/new\s+Date\s*\(|Date\.now\s*\(/,language+' date must not vary during rendering');
}

// Protect the legally different clocks without locking whole prose paragraphs.
// These are content regression guards, not a substitute for legal review.
for(const [language,words]of Object.entries({
 az:{working:/7\s+iş\s+günü/u,delivery:/30\s+gün/u,refund:/7\s+gün/u,exchange:/14\s+gün/u,physical:/faktiki\s+təhvil/u,excluded:/təhvil\s+günü\s+sayılmadan/u,alternative:/başqa\s+müddət\s+razılaşdırmayıbsa/u,sent:/göndərildiyi\s+gündən/u},
 en:{working:/7\s+working\s+days/i,delivery:/30\s+days/i,refund:/7\s+days/i,exchange:/14\s+days/i,physical:/physically\s+received/i,excluded:/excluding\s+the\s+day\s+of\s+receipt/i,alternative:/unless\s+the\s+parties\s+agree\s+on\s+another\s+period/i,sent:/from\s+the\s+date\s+it\s+is\s+sent/i},
})){
 const document=termsContent[language],withdrawal=section(document,'legv-imtina'),delivery=section(document,'tehvil-catdirilma').paragraphs[2],exchange=section(document,'deyisdirme-qusur').paragraphs[0];
 assert.match(withdrawal.paragraphs[1],words.working,language+' withdrawal uses working days, not calendar days');
 assert.match(withdrawal.paragraphs[1],/9\.2[–-]9\.3/u,language+' withdrawal start retains the statutory qualifications');
 assert.match(withdrawal.paragraphs[2],/9\.4/u,language+' withdrawal refund is identified separately');
 assert.match(withdrawal.paragraphs[2],words.refund,language+' withdrawal refund uses 7 days');
 for(const expression of [words.delivery,words.refund,words.alternative,words.sent])assert.match(delivery,expression,language+' delivery deadline/unavailability refund qualifications');
 for(const expression of [words.exchange,words.physical,words.excluded])assert.match(exchange,expression,language+' exchange clock follows actual receipt, excluding receipt day');
 assert.ok(document.sources.some(source=>source.href===sourceUrls[2]),language+' retains the Civil Code source relevant to physical receipt');
}
assert.equal(termsContent.en.updatedDate,'8 November 2026');

const {termsUiTranslations}=await load('lib/terms-ui-translations.ts');
const titleRow=termsUiTranslations.find(row=>row[0]===termsContent.az.title);
assert.ok(titleRow,'The terms link/title must be translated in the actual UI dictionary');
for(const row of termsUiTranslations){assert.equal(row.length,5);for(const value of row)nonempty(value,'Five-language legal UI label');}
for(const [index,language]of languages.entries())assert.equal(titleRow[index],termsContent[language].title,language+' legal UI title matches document');
const languageSource=await readFile('lib/language.tsx','utf8'),tree=ts.createSourceFile('lib/language.tsx',languageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let imported=false,spread=false;
function scan(node){
 if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==='./terms-ui-translations'){
  const binding=node.importClause?.namedBindings;
  imported=Boolean(binding&&ts.isNamedImports(binding)&&binding.elements.some(item=>item.name.text==='termsUiTranslations'));
 }
 if(ts.isSpreadElement(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='termsUiTranslations')spread=true;
 ts.forEachChild(node,scan);
}
scan(tree);assert.equal(imported,true,'Legal UI dictionary is imported');assert.equal(spread,true,'Legal UI dictionary is registered');
console.log('PASS: complete published AZ/RU/EN/TR/ZH terms, 17 stable anchors and matching structure, fixed version/dates, five official sources, approved contact/no invented tax identity or placeholders, language/UI registration and AZ/EN statutory deadline distinctions. Pure source test only.');
