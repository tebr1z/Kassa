import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import ts from 'typescript';

// Pure component/AST checks: no requests, iframe loading, storage or database.
const require=createRequire(import.meta.url);
let language='az';
const source=await readFile('app/storefront-presence.tsx','utf8');
const compiled=ts.transpileModule(source,{fileName:'app/storefront-presence.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[]);
const loaded={exports:{}};
new Function('require','module','exports',compiled.outputText)(name=>name==='@/lib/language'?{useTranslations:()=>({language})}:name.endsWith('.css')?{}:require(name),loaded,loaded.exports);
const {AboutLocation,StoreSocialLinks}=loaded.exports;
function nodes(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
const socialUrls=['https://www.instagram.com/restamarket.az/','https://www.tiktok.com/@restamarket.az','https://www.youtube.com/@restamarket_az'];
const mapUrl='https://maps.app.goo.gl/oyjVNCWgfu4EoGnT8';
const embed='https://www.google.com/maps/embed?origin=mfe&pb=!1m3!3m2!1m1!4s12618702231415660293';
const titles=new Set();
for(language of ['az','ru','en','tr','zh']){
 const location=AboutLocation({address:'Merchant address is retained'}),all=nodes(location);
 const frames=all.filter(node=>node.type==='iframe');assert.equal(frames.length,1);
 const frame=frames[0];assert.equal(frame.props.src,embed);assert.equal(frame.props.loading,'lazy');assert.equal(frame.props.allow,undefined,'No location/camera permission is requested');assert.ok(frame.props.title);titles.add(frame.props.title);
 assert.ok(all.some(node=>node.props?.children==='Merchant address is retained'));
 const links=all.filter(node=>node.type==='a');assert.equal(links.length,2);
 for(const link of links){assert.equal(link.props.href,mapUrl);assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');assert.ok(link.props['aria-label']);}
 const social=nodes(StoreSocialLinks()),socialAnchors=social.filter(node=>node.type==='a');
 assert.deepEqual(socialAnchors.map(node=>node.props.href),socialUrls);
 for(const link of socialAnchors){assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');assert.ok(link.props['aria-label'].includes('RestaMarket'));assert.equal(new URL(link.props.href).search,'');}
 const html=renderToStaticMarkup(createElement(AboutLocation,{address:''}))+renderToStaticMarkup(createElement(StoreSocialLinks));
 assert.ok(!html.includes('undefined'));assert.equal((html.match(/<iframe/g)||[]).length,1);assert.equal((html.match(/<script/g)||[]).length,0);
}
assert.equal(titles.size,5,'Map labels are localized in every supported language');

const storefront=await readFile('app/storefront.tsx','utf8');
const ast=ts.createSourceFile('storefront.tsx',storefront,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const usages={AboutLocation:[],StoreSocialLinks:[]};
function visit(node){
 if(ts.isJsxSelfClosingElement(node)&&Object.hasOwn(usages,node.tagName.getText(ast)))usages[node.tagName.getText(ast)].push(node);
 ts.forEachChild(node,visit);
}
visit(ast);
function within(node,tag,id){
 for(let parent=node.parent;parent;parent=parent.parent){
  if(!ts.isJsxElement(parent)||parent.openingElement.tagName.getText(ast)!==tag)continue;
  if(!id)return true;
  if(parent.openingElement.attributes.properties.some(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(ast)==='id'&&ts.isStringLiteral(attribute.initializer)&&attribute.initializer.text===id))return true;
 }
 return false;
}
assert.equal(usages.AboutLocation.length,1);assert.equal(within(usages.AboutLocation[0],'section','about'),true,'Store map must be inside About only');
assert.equal(usages.StoreSocialLinks.length,1);assert.equal(within(usages.StoreSocialLinks[0],'footer'),true,'Social links must be in the footer');
console.log('PASS: exact store map only inside About, social links only in footer, five languages, safe clean external links, lazy iframe and no extra browser permissions/scripts; no network or business data used.');
