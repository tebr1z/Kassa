import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const code=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const compiledModule={exports:{}};new Function('require','module','exports',code)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),compiledModule,compiledModule.exports);return compiledModule.exports;
}
const languages=['az','ru','en','tr','zh'];
const {termsUiTranslations}=await load('lib/terms-ui-translations.ts');
for(const row of termsUiTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>value.trim()));}
const fixture=Object.fromEntries(languages.map(language=>[language,{status:'published',title:'Title '+language,intro:['Intro '+language],updatedDate:'2026-11-07',sections:[{id:'scope',title:'Scope '+language,paragraphs:['Plain <script>text</script> '+language],bullets:['Item '+language],subsections:[{title:'Subtitle '+language,paragraphs:['Body '+language]}]}],sources:[{label:'Source '+language,href:'https://example.test/source'}]}]));
let language='az';
const icons=Object.fromEntries(['ArrowLeft','ArrowUp','ChevronDown','ExternalLink','FileText'].map(name=>[name,()=>null]));
const {default:LegalDocument}=await load('app/legal-document.tsx',{
 'next/link':({children,...props})=>createElement('a',props,children),
 'lucide-react':icons,'@/lib/language':{useTranslations:()=>({language,t:key=>termsUiTranslations.find(row=>row[0]===key)?.[languages.indexOf(language)]||key}),LanguageSwitcher:()=>createElement('button',{type:'button'},'Language')},
 './brand-logo':{BrandLogo:()=>createElement('span',null,'Logo')},'./legal-document.css':{},
});
for(const selected of languages){
 language=selected;const html=renderToStaticMarkup(createElement(LegalDocument,{content:fixture}));
 assert.ok(html.includes('lang="'+selected+'"'));for(const text of ['Title ','Intro ','Scope ','Subtitle ','Body '])assert.ok(html.includes(text+selected));
 assert.ok(html.includes('href="#terms-scope"'));assert.equal((html.match(/id="terms-scope"/g)||[]).length,1);assert.ok(html.includes('id="terms-heading-scope"'));
 assert.ok(html.includes('&lt;script&gt;text&lt;/script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('class="legal-draft"'));
 assert.ok(html.includes('2026-11-07'));assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));assert.ok(!html.includes('<form'));assert.ok(!html.includes('type="checkbox"'));
 assert.ok(html.includes('class="legal-mobile-toc"'));assert.ok(html.includes('class="legal-sidebar"'));
}
language='az';const draft={...fixture,az:{...fixture.az,status:'draft',notice:'Review notice'}};const draftHtml=renderToStaticMarkup(createElement(LegalDocument,{content:draft}));assert.ok(draftHtml.includes('class="legal-draft"'));assert.ok(draftHtml.includes('Review notice'));
const component=await readFile('app/legal-document.tsx','utf8');assert.ok(!component.includes('new Date('));assert.ok(!component.includes('dangerouslySetInnerHTML'));assert.ok(!component.includes('fetch('),'The public legal document does not need catalogue/customer/staff data');
const legalCss=await readFile('app/legal-document.css','utf8'),printCss=legalCss.slice(legalCss.lastIndexOf('@media print'));
assert.match(printCss,/\.legal-page\s*,\s*\.legal-page\s+\*\s*\{visibility:visible!important\}/,'Legal text overrides the global receipt-only hidden print visibility');
assert.ok(printCss.includes('body:has(.legal-page) .print-sheet{display:none!important}'),'A lingering receipt print portal cannot replace or overlay the legal document');
assert.ok(printCss.includes('.legal-header,.legal-sidebar,.legal-mobile-toc,.legal-footer,.legal-top,.legal-skip{display:none!important}'),'Print output hides navigation, not the document');
const languageCss=await readFile('app/language-switcher.css','utf8'),utilityHide=languageCss.split(/\r?\n/).find(line=>line.includes('.language-utility{display:none}'));
assert.ok(utilityHide);for(const page of ['.storefront','.account','.app-shell','.auth-page','.auth-loading','.legal-page'])assert.ok(utilityHide.includes(page),'Existing language utility exclusion plus the legal header: '+page);
assert.ok((await readFile('app/storefront.tsx','utf8')).includes('<Link href="/istifadeci-sertleri/">'));

// Run the actual Proxy with an isolated response/DB adapter. The new public
// exception cannot widen staff/API authorization or alter product canonicals.
class FakeNextResponse extends Response{
 static next(options={}){const response=new FakeNextResponse(null,{status:200});response.forwardedHeaders=options.request?.headers;return response;}
 static redirect(url,status=307){return new FakeNextResponse(null,{status,headers:{Location:String(url)}});}
 static json(value,options){return Response.json(value,options);}
}
const access=await load('lib/staff-access.ts'),portal=await load('lib/staff-portal.ts'),security=await load('lib/admin-security.ts');
const inventory=await load('lib/inventory-mode.ts',{'server-only':{}});
let connections=0;
const {proxy,config}=await load('proxy.ts',{'next/server':{NextResponse:FakeNextResponse},postgres:()=>{connections++;throw Error('Unexpected database connection');},'./lib/log-error':{logSystemError:async()=>{}},'./lib/admin-security':security,'./lib/staff-access':access,'./lib/staff-portal':portal,'./lib/inventory-mode':inventory});
const request=path=>{const value=new Request('https://restamarket.az'+path,{headers:{'x-birkassa-user-id':'forged','x-birkassa-role':'admin'}});value.nextUrl=new URL(value.url);value.cookies={get:()=>undefined};return value;};
assert.ok(config.matcher.includes('/istifadeci-sertleri/:path*'));
let response=await proxy(request('/istifadeci-sertleri?source=footer'));assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://restamarket.az/istifadeci-sertleri/?source=footer');
response=await proxy(request('/istifadeci-sertleri/'));assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),null);assert.equal(response.forwardedHeaders.get('x-birkassa-role'),null);assert.equal(response.forwardedHeaders.get('x-birkassa-user-id'),null);assert.equal(connections,0);
assert.equal((await proxy(request('/api/products'))).status,401);assert.equal((await proxy(request('/admin'))).status,404);assert.equal((await proxy(request(portal.staffPortalPath('/store')))).status,307);
response=await proxy(request('/api/products/'));assert.equal(response.status,308);assert.equal(new URL(response.headers.get('location')).pathname,'/api/products');
response=await proxy(request('/account/'));assert.equal(response.status,308);assert.equal(new URL(response.headers.get('location')).pathname,'/account');
response=await proxy(request('/mehsullar/123456-product/'));assert.equal(response.status,200);assert.equal(response.forwardedHeaders.get('x-restamarket-product-pathname'),'/mehsullar/123456-product/');
assert.equal(connections,0,'Anonymous public/staff guard checks do not contact a real database');
const page=await readFile('app/istifadeci-sertleri/page.tsx','utf8');assert.ok(page.includes('publicMetadata('));assert.ok(page.includes("'/istifadeci-sertleri/'"));assert.ok(page.includes("status==='published'"));assert.ok(page.includes('robots:privateRobots'),'Draft content stays out of indexes even if accidentally deployed');
const {default:sitemap}=await load('app/sitemap.ts',{'@/lib/terms-content':{termsContent:fixture},'@/lib/public-catalog':{getPublicCatalog:async()=>({products:[],categories:[]})},'@/lib/commerce':{productPath:()=>''},'@/lib/seo':{absoluteUrl:path=>'https://restamarket.az'+path}});
const localMode=process.env.BIRKASSA_LOCAL;
try{
 delete process.env.BIRKASSA_LOCAL;
 let entries=await sitemap();const publishedEntry=entries.find(entry=>entry.url==='https://restamarket.az/istifadeci-sertleri/');assert.ok(publishedEntry);assert.ok(!Object.hasOwn(publishedEntry,'lastModified'),'No invented update date in the sitemap');
 fixture.az.status='draft';entries=await sitemap();assert.ok(!entries.some(entry=>entry.url.includes('/istifadeci-sertleri/')));fixture.az.status='published';
 process.env.BIRKASSA_LOCAL='1';assert.deepEqual(await sitemap(),[],'Desktop sitemap remains disabled');
}finally{if(localMode===undefined)delete process.env.BIRKASSA_LOCAL;else process.env.BIRKASSA_LOCAL=localMode;}
console.log('PASS: real legal UI renders five languages, stable anchors/date, safe plain text, draft/published states, no consent mutations, shared footer, public slash canonical and unchanged staff/API/product guards.');
