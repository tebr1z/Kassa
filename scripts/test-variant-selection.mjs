import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const code=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const module={exports:{}};new Function('require','module','exports',code)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),module,module.exports);return module.exports;
}
const commerce=await load('lib/commerce.ts');
const {variantSelection,canonicalVariantSelectionPath}=await load('lib/variant-selection.ts',{'./commerce':commerce,'@/lib/commerce':commerce});
const {productVariantPath,productPath,productVariantSlug}=commerce;
const query=value=>new URL(value.startsWith('/')?value:'/?'+value,'https://restamarket.az').searchParams;
const choice=(id,size,color,kind='',attributes={},price=null)=>({id,label:[size,color,kind].filter(Boolean).join(' · ')||id,size,color,kind,attributes,price});
const product={id:'selection-product',code:'123456',name:'Seçimli manqal',price:7,originalPrice:7,basePrice:16,baseOriginalPrice:20,options:[choice('red30','30 sm','Qırmızı','',{},7),choice('red40','40 sm','Qırmızı','',{},9),choice('black40','40 sm','Qara','',{},11)]};
const group=(state,key)=>{const found=state.groups.find(item=>item.key===key);assert.ok(found,'Missing group: '+key);return found;};
const item=(state,key,label)=>{const found=group(state,key).choices.find(item=>item.label===label);assert.ok(found,'Missing choice: '+key+'='+label);return found;};
const selected=(p,url)=>variantSelection(p,query(url)).selectedOption?.id;
const initial=variantSelection(product,query(''));
assert.deepEqual(initial.groups.map(group=>group.key),['reng','olcu'],'Color precedes size; empty kind fields do not invent another step');
assert.equal(initial.valid,true);assert.equal(initial.selectedOption,undefined);assert.equal(group(initial,'reng').enabled,true);assert.equal(group(initial,'olcu').enabled,false);
assert.equal(initial.showRemainingOptions,false,'Exact fallback options are not a substitute for first choosing the required dimensions');
const red=item(initial,'reng','Qırmızı'),redState=variantSelection(product,query(red.href));
assert.equal(query(red.href).get('reng'),'qirmizi');assert.equal(query(red.href).get('olcu'),null);assert.equal(redState.selectedOption,undefined);assert.equal(group(redState,'olcu').enabled,true);
assert.equal(group(redState,'reng').choices.find(choice=>choice.selected)?.label,'Qırmızı');
assert.equal(group(redState,'reng').selectedValue,red.value);
assert.deepEqual(group(redState,'olcu').choices.map(choice=>choice.label),['30 sm','40 sm']);
const red30=item(redState,'olcu','30 sm');assert.equal(selected(product,red30.href),'red30');
const fullRed30=variantSelection(product,query(productVariantPath(product,product.options[0])));assert.equal(fullRed30.selectedOption?.price,7);
const black=item(fullRed30,'reng','Qara'),blackState=variantSelection(product,query(black.href));
for(const key of ['olcu','nov','secim','variant'])assert.equal(query(black.href).get(key),null,'Changing an earlier dimension resets '+key);
assert.equal(blackState.selectedOption,undefined,'Even a color with one available size requires that size to be explicitly chosen');
assert.deepEqual(group(blackState,'olcu').choices.map(choice=>choice.label),['40 sm'],'Sparse catalogues do not invent unavailable color/size combinations');
assert.equal(selected(product,item(blackState,'olcu','40 sm').href),'black40');
assert.equal(selected(product,'reng=qara&olcu=30-sm'),undefined,'An impossible combination never silently chooses a different size');

for(const option of product.options){
 const full=productVariantPath(product,option);assert.equal(selected(product,full),option.id);assert.equal(selected(product,'variant='+option.id),option.id,'Existing shared UUID links stay exact');
 assert.equal(canonicalVariantSelectionPath(product,query(full)),full);
 assert.equal(canonicalVariantSelectionPath(product,query('variant='+option.id)),full);
}
for(const invalid of ['variant=missing','reng=missing','reng=qirmizi&reng=qara','reng=qirmizi&olcu=30-sm&olcu=40-sm','reng=qirmizi&olcu=30-sm&variant=black40','reng=qara&olcu=30-sm','secim=missing']){
 const state=variantSelection(product,query(invalid));assert.equal(state.selectedOption,undefined,'Malformed/conflicting selection cannot enable ordering: '+invalid);assert.equal(state.valid,false,invalid);
}
const partialPath=canonicalVariantSelectionPath(product,query('reng=qirmizi'));assert.equal(new URL(partialPath,'https://restamarket.az').pathname,productPath(product));assert.equal(query(partialPath).get('reng'),'qirmizi');assert.equal(query(partialPath).get('olcu'),null,'Legacy/canonical redirect preserves partial progress instead of choosing a size');
assert.equal(canonicalVariantSelectionPath(product,query('reng=missing')),productPath(product));
const renamed={...product,name:'Yeni adlı manqal'};assert.equal(new URL(canonicalVariantSelectionPath(renamed,query(red.href)),'https://restamarket.az').pathname,productPath(renamed));assert.equal(query(canonicalVariantSelectionPath(renamed,query(red.href))).get('reng'),'qirmizi');
const history=['',red.href,red30.href,black.href,item(blackState,'olcu','40 sm').href];
assert.deepEqual([4,3,2,1,0,4].map(index=>selected(product,history[index])),['black40',undefined,'red30',undefined,undefined,'black40'],'Back/Forward restores exact or partial state entirely from each history URL');

const colorOnly={...product,options:[choice('red','','Qırmızı'),choice('black','','Qara')]};
assert.deepEqual(variantSelection(colorOnly,query('')).groups.map(group=>group.key),['reng']);
assert.equal(selected(colorOnly,item(variantSelection(colorOnly,query('')),'reng','Qara').href),'black');
const sizeOnly={...product,options:[choice('small','30 sm',''),choice('large','40 sm','')]};
assert.deepEqual(variantSelection(sizeOnly,query('')).groups.map(group=>group.key),['olcu']);
assert.equal(selected(sizeOnly,item(variantSelection(sizeOnly,query('')),'olcu','40 sm').href),'large');
const typed={...product,options:[choice('thin','40 sm','Qara','Nazik'),choice('thick','40 sm','Qara','Qalın')]};
const typedState=variantSelection(typed,query('reng=qara&olcu=40-sm'));assert.deepEqual(typedState.groups.map(group=>group.key),['reng','olcu','nov']);assert.equal(typedState.selectedOption,undefined);assert.equal(group(typedState,'nov').enabled,true);assert.equal(selected(typed,item(typedState,'nov','Qalın').href),'thick');

const custom={...product,options:[choice('custom2','40 sm','Qara','Dəmir',{'Qalınlıq':'2 mm'},null),choice('custom3','40 sm','Qara','Dəmir',{'Qalınlıq':'3 mm'},18)]};
const customState=variantSelection(custom,query('reng=qara&olcu=40-sm&nov=demir'));assert.equal(customState.selectedOption,undefined);assert.equal(customState.showRemainingOptions,true);assert.deepEqual(customState.remainingOptions.map(option=>option.id),['custom2','custom3']);
for(const option of custom.options){const full=productVariantPath(custom,option);assert.ok(query(full).get('secim'));assert.equal(selected(custom,full),option.id);}
const uniqueCustom={...custom,options:[custom.options[0]]};assert.equal(selected(uniqueCustom,'reng=qara&olcu=40-sm&nov=demir'),undefined,'A unique custom option still requires its explicit canonical secim token');assert.equal(selected(uniqueCustom,productVariantPath(uniqueCustom,uniqueCustom.options[0])),'custom2');
const labels={...product,options:[{...choice('label-a','',''),label:'Standart'},{...choice('label-b','',''),label:'Premium'}]};
const labelState=variantSelection(labels,query(''));assert.deepEqual(labelState.groups,[]);assert.equal(labelState.showRemainingOptions,true);assert.deepEqual(labelState.remainingOptions.map(option=>option.id),['label-a','label-b']);
for(const option of labels.options)assert.equal(selected(labels,productVariantPath(labels,option)),option.id);

const mixed={...product,options:[choice('mixed-red','30 sm','Qırmızı'),choice('mixed-blank','40 sm','')]};
assert.deepEqual(variantSelection(mixed,query('')).groups.map(group=>group.key),['olcu'],'A partly-empty dimension uses exact fallback choices instead of losing the blank option');
for(const option of mixed.options)assert.equal(selected(mixed,productVariantPath(mixed,option)),option.id);
const mixedSameSize={...product,options:[choice('same-red','40 sm','Qırmızı'),choice('same-blank','40 sm','')]};
for(const option of mixedSameSize.options)assert.equal(selected(mixedSameSize,productVariantPath(mixedSameSize,option)),option.id,'A blank dimension cannot create an ambiguous full URL');
const collision={...product,options:[choice('collision-a','40 sm','Əla'),choice('collision-b','40 sm','Ela')]};
assert.equal(productVariantSlug(collision.options[0].color),productVariantSlug(collision.options[1].color));
assert.ok(!variantSelection(collision,query('')).groups.some(group=>group.key==='reng'),'Distinct colors with colliding URL slugs do not merge into one misleading swatch');
for(const option of collision.options)assert.equal(selected(collision,productVariantPath(collision,option)),option.id,'Colliding values remain reachable through exact full links');
const unsluggable={...product,options:[choice('emoji','40 sm','🔥'),choice('blue','40 sm','蓝色')]};
assert.ok(!variantSelection(unsluggable,query('')).groups.some(group=>group.key==='reng'));for(const option of unsluggable.options)assert.equal(selected(unsluggable,productVariantPath(unsluggable,option)),option.id);
const plain=variantSelection({...product,options:[]},query(''));assert.deepEqual(plain.groups,[]);assert.deepEqual(plain.remainingOptions,[]);assert.equal(plain.showRemainingOptions,false);

const {default:Picker}=await load('app/product-variant-picker.tsx',{
 '@/lib/commerce':commerce,'@/lib/language':{useTranslations:()=>({t:value=>value})},
 'lucide-react':{Check:()=>null,ChevronDown:()=>null},'./product-variant-picker.css':{},
});
const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[char]));
const render=(p,state)=>renderToStaticMarkup(createElement(Picker,{product:p,selection:state,onNavigate(){}}));
for(const [p,state] of [[product,initial],[product,redState],[product,fullRed30],[custom,customState],[labels,labelState],[mixedSameSize,variantSelection(mixedSameSize,query(''))]]){
 const html=render(p,state);for(const option of p.options)assert.ok(html.includes('href="'+escape(productVariantPath(p,option))+'"'),'Every real exact option remains a server-rendered crawlable link');
 for(const anchor of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g))assert.doesNotMatch(anchor[1],/<(?:small|b)>|\bAZN\b|₼/,'Group and full-option chips remain price-free');
}
const initialHtml=render(product,initial);assert.ok(initialHtml.indexOf('Rəng')<initialHtml.indexOf('Ölçü'));assert.match(initialHtml,/<fieldset[^>]*disabled/);assert.match(initialHtml,/<details class="pd-choice-all">/,'Complete exact links are in a legitimate user-visible disclosure');
const selectedHtml=render(product,fullRed30);assert.match(selectedHtml,/<a[^>]+class="[^"]*pd-variant-option[^"]*"[^>]+aria-current="true"/);assert.match(selectedHtml,/class="pd-choice-summary"/);
assert.equal(render({...product,options:[]},plain),'');
const navigations=[],tree=Picker({product,selection:initial,onNavigate:href=>navigations.push(href)});
function anchors(node){if(!node||typeof node!=='object')return [];const children=node.props?.children;return [...(node.type==='a'?[node]:[]),...(Array.isArray(children)?children.flat(Infinity):[children]).flatMap(anchors)];}
const anchor=anchors(tree).find(node=>node.props.href===red.href);assert.ok(anchor);
for(const override of [{button:1},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true}]){let prevented=false;anchor.props.onClick({button:0,...override,preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(navigations.length,0,'Modified clicks retain native open-in-new-tab behavior');}
let prevented=false;anchor.props.onClick({button:0,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.deepEqual(navigations,[red.href]);
console.log('PASS: color→size→kind exact selection, sparse/reset/history/redirect state, mixed/custom/colliding fallback, real SSR price-free crawlable chips, native modified clicks and exact option links.');
