import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Real EventTarget semantics, but no DOM, script loader, Google endpoint, key or
// billable provider request. The place and import promises are controlled here.
const compiled=ts.transpileModule(await readFile('lib/google-address.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {attachGoogleAddressSearch,googleAddressLanguage}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const code=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const loaded={exports:{}};new Function('require','module','exports',code)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
for(const language of ['az','ru','en','tr'])assert.equal(googleAddressLanguage(language),language);
assert.equal(googleAddressLanguage('zh'),'zh-CN');

class Element extends EventTarget{
 attributes=new Map();parent=null;children=[];added=[];removed=[];removeCount=0;
 setAttribute(name,value){this.attributes.set(name,value);}
 getAttribute(name){return this.attributes.get(name);}
 replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=children;for(const child of children)child.parent=this;}
 remove(){this.removeCount++;if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
 addEventListener(name,callback,...options){this.added.push(name);super.addEventListener(name,callback,...options);}
 removeEventListener(name,callback,...options){this.removed.push(name);super.removeEventListener(name,callback,...options);}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<3;index++)await Promise.resolve();};
function fixture({language='az',current=true,blocked=false,importPromise}={}){
 const state={current,blocked,version:'Initial address|40.1,49.1',selected:[],errors:0,imports:[],constructed:[]};
 const host=new Element(),prior=new Element();host.replaceChildren(prior);
 class PlaceAutocompleteElement extends Element{
  constructor(options){super();Object.assign(this,options);state.constructed.push(this);this.options=options;}
 }
 const api={async importLibrary(name){state.imports.push(name);if(importPromise)await importPromise;return {PlaceAutocompleteElement};}};
 const options={placeholder:'Google-da ünvan axtarın',language,isCurrent:()=>state.current,isBlocked:()=>state.blocked,version:()=>state.version,onSelect:(address,pin)=>state.selected.push({address,pin}),onError:()=>state.errors++};
 return {state,host,prior,api,options,attach:()=>attachGoogleAddressSearch(api,host,options)};
}
function place({address='  Bakı, Nizami küçəsi 10  ',lat=40.409312345,lng=49.86716789,work=Promise.resolve(),missingLocation=false}={}){
 const fields=[];
 const value={formattedAddress:address,location:missingLocation?undefined:{lat:()=>lat,lng:()=>lng},async fetchFields(options){fields.push(options);await work;}};
 return {value,fields};
}
function select(widget,value,name='gmp-select'){
 const event=new Event(name);
 if(value)Object.assign(event,{placePrediction:{toPlace:()=>value}});
 widget.dispatchEvent(event);
}

for(const language of ['az','ru','en','tr','zh']){
 const f=fixture({language}),controller=await f.attach();
 assert.ok(controller);assert.deepEqual(f.state.imports,['places']);assert.deepEqual(f.host.children,[controller.widget]);assert.equal(f.prior.parent,null);
 assert.deepEqual(controller.widget.options,{includedRegionCodes:['az'],requestedRegion:'az',requestedLanguage:language==='zh'?'zh-CN':language});
 assert.equal(controller.widget.placeholder,f.options.placeholder);assert.equal(controller.widget.getAttribute('aria-label'),f.options.placeholder);assert.equal(controller.widget.disabled,false);
 assert.deepEqual(controller.widget.added,['gmp-select','gmp-error'],'Current official widget events, not deprecated gmp-placeselect');
 const prediction=place();select(controller.widget,prediction.value);await flush();
 assert.deepEqual(prediction.fields,[{fields:['formattedAddress','location']}],'Only address and coordinates are requested after explicit prediction selection');
 assert.deepEqual(f.state.selected,[{address:'Bakı, Nizami küçəsi 10',pin:{lat:40.409312,lng:49.867168}}]);assert.equal(f.state.errors,0);
 controller.destroy();assert.deepEqual(f.host.children,[]);assert.deepEqual(controller.widget.removed,['gmp-select','gmp-error']);
}
{
 const f=fixture(),controller=await f.attach(),prediction=place({address:'X'.repeat(600),lat:0,lng:0});
 select(controller.widget,prediction.value);await flush();assert.equal(f.state.selected[0].address.length,500);assert.deepEqual(f.state.selected[0].pin,{lat:0,lng:0});controller.destroy();
}
for(const [lat,lng]of [[90,180],[-90,-180]]){
 const f=fixture(),controller=await f.attach();select(controller.widget,place({lat,lng}).value);await flush();assert.deepEqual(f.state.selected[0].pin,{lat,lng});controller.destroy();
}
for(const invalid of [{address:undefined},{address:''},{address:'   '},{missingLocation:true},{lat:NaN},{lng:NaN},{lat:Infinity},{lng:-Infinity},{lat:90.0001},{lat:-90.0001},{lng:180.0001},{lng:-180.0001},{lat:'40.1'},{lng:null}]){
 const f=fixture(),controller=await f.attach(),prediction=place(invalid);
 // An explicit undefined must model an absent provider field, not the factory's default.
 if(Object.hasOwn(invalid,'address'))prediction.value.formattedAddress=invalid.address;
 select(controller.widget,prediction.value);await flush();assert.equal(f.state.selected.length,0,JSON.stringify(invalid));assert.equal(f.state.errors,1,'Invalid/missing provider fields must not overwrite delivery details');controller.destroy();
}
{
 const f=fixture(),controller=await f.attach();select(controller.widget);await flush();assert.equal(f.state.errors,1);assert.equal(f.state.selected.length,0);
 const prediction=place();select(controller.widget,prediction.value,'gmp-placeselect');await flush();assert.equal(prediction.fields.length,0,'Deprecated event names do not accidentally trigger provider field requests');controller.destroy();
}
{
 const f=fixture(),controller=await f.attach(),first=deferred(),second=deferred(),a=place({address:'Old prediction address',work:first.promise}),b=place({address:'Latest prediction address',lat:41.12345678,lng:50.12345678,work:second.promise});
 select(controller.widget,a.value);select(controller.widget,b.value);second.resolve();await flush();first.resolve();await flush();
 assert.deepEqual(f.state.selected,[{address:'Latest prediction address',pin:{lat:41.123457,lng:50.123457}}]);assert.equal(f.state.errors,0);controller.destroy();
}
{
 const f=fixture(),controller=await f.attach(),first=deferred(),second=deferred();
 select(controller.widget,place({work:first.promise}).value);select(controller.widget,place({address:'Second address',work:second.promise}).value);
 first.reject(Error('Old request failed'));await flush();assert.equal(f.state.errors,0);assert.equal(f.state.selected.length,0);
 second.resolve();await flush();assert.equal(f.state.selected[0].address,'Second address');controller.destroy();
}
{
 const f=fixture(),controller=await f.attach(),first=deferred(),second=deferred();
 select(controller.widget,place({work:first.promise}).value);select(controller.widget,place({work:second.promise}).value);
 first.resolve();await flush();assert.equal(f.state.selected.length,0,'First result cannot win while a newer selection is pending');
 second.reject(Error('Current prediction failed'));await flush();assert.equal(f.state.selected.length,0);assert.equal(f.state.errors,1);controller.destroy();
}
for(const changedVersion of ['Manual address edit|40.1,49.1','Initial address|40.5,49.5'])for(const reject of [false,true]){
 const f=fixture(),controller=await f.attach(),work=deferred();select(controller.widget,place({work:work.promise}).value);f.state.version=changedVersion;
 if(reject)work.reject(Error('Stale provider error'));else work.resolve();await flush();assert.equal(f.state.selected.length,0,'A manual address/pin change invalidates pending predictions');assert.equal(f.state.errors,0,'A stale error must not replace manual input status');controller.destroy();
}
for(const blockedAtStart of [false,true]){
 const f=fixture({blocked:blockedAtStart}),controller=await f.attach(),work=deferred(),prediction=place({work:work.promise});
 assert.equal(controller.widget.disabled,blockedAtStart);
 select(controller.widget,prediction.value);
 if(blockedAtStart){assert.equal(prediction.fields.length,0,'Disabled controls must not issue place-detail requests');controller.widget.dispatchEvent(new Event('gmp-error'));assert.equal(f.state.errors,0);}
 else f.state.blocked=true;
 work.resolve();await flush();assert.equal(f.state.selected.length,0);assert.equal(f.state.errors,0);controller.destroy();
}
for(const cancellation of ['destroy','not-current'])for(const reject of [false,true]){
 const f=fixture(),controller=await f.attach(),work=deferred(),prediction=place({work:work.promise});select(controller.widget,prediction.value);
 if(cancellation==='destroy')controller.destroy();else f.state.current=false;
 if(reject)work.reject(Error('Cancelled work'));else work.resolve();await flush();
 assert.equal(f.state.selected.length,0);assert.equal(f.state.errors,0);
 const count=prediction.fields.length;select(controller.widget,prediction.value);controller.widget.dispatchEvent(new Event('gmp-error'));await flush();assert.equal(prediction.fields.length,count);assert.equal(f.state.errors,0);controller.destroy();
}
{
 const importing=deferred(),f=fixture({importPromise:importing.promise}),attached=f.attach();f.state.current=false;importing.resolve();
 assert.equal(await attached,null);assert.equal(f.state.constructed.length,0);assert.deepEqual(f.host.children,[f.prior],'An obsolete library import must not replace another control');
}
{
 const f=fixture();f.api.importLibrary=async()=>{throw Error('Fixture places import unavailable');};await assert.rejects(f.attach(),/Fixture places import unavailable/);
 assert.deepEqual(f.host.children,[f.prior]);assert.equal(f.state.selected.length,0);assert.equal(f.state.errors,0,'Import errors propagate to the map fallback owner');
}
{
 const f=fixture(),controller=await f.attach(),work=deferred();select(controller.widget,place({work:work.promise}).value);
 controller.widget.dispatchEvent(new Event('gmp-error'));assert.equal(f.state.errors,1,'Current official gmp-error is surfaced');work.resolve();await flush();assert.equal(f.state.selected.length,0,'A widget-level provider error invalidates its pending detail request');
 controller.destroy();controller.widget.dispatchEvent(new Event('gmp-error'));assert.equal(f.state.errors,1);
}
// Validate the real component's GPS callbacks as well: a late GPS fix must not
// replace a newer manual/Google selection, win over a newer GPS request, or run
// after the checkout was unmounted. No map script is opened by this harness.
let hooks=[],cursor=0,pendingEffects=[],gps=[],picked=[],writes=0;
const react={
 useRef(initial){const index=cursor++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index];},
 useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=initial;return [hooks[index],value=>{writes++;hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},
 useEffect(callback,deps){const index=cursor++,previous=hooks[index];if(!previous||deps.some((value,offset)=>value!==previous.deps[offset])){hooks[index]={deps,cleanup:previous?.cleanup};pendingEffects.push(()=>{previous?.cleanup?.();hooks[index].cleanup=callback();});}},
};
const {default:LocationPicker}=await load('app/delivery-location-picker.tsx',{
 react,'@/lib/language':{useTranslations:()=>({t:value=>value,language:'az'})},'@/lib/google-address':{attachGoogleAddressSearch,googleAddressLanguage},'lucide-react':{LocateFixed:()=>null,MapPin:()=>null},'./google-address.css':{},
});
let revision=0;
const props={browserKey:'',pin:null,address:'Initial address',selectionVersion:()=>revision,onPick:pin=>picked.push(pin)};
function render(changes={}){
 cursor=0;const tree=LocationPicker({...props,...changes});for(const effect of pendingEffects.splice(0))effect();return tree;
}
function buttons(node){if(!node||typeof node!=='object')return [];const children=node.props?.children;return [...(node.type==='button'?[node]:[]),...(Array.isArray(children)?children.flat(Infinity):[children]).flatMap(buttons)];}
function startGps(tree=render()){
 const locate=buttons(tree).find(node=>(Array.isArray(node.props.children)?node.props.children:[node.props.children]).includes('Cari məkanım'));assert.ok(locate);locate.props.onClick();return gps.at(-1);
}
function mount(){hooks=[];cursor=0;pendingEffects=[];gps=[];picked=[];writes=0;revision=0;return render();}
function unmount(){for(const hook of hooks)hook?.cleanup?.();}
const position={coords:{latitude:40.12345678,longitude:49.12345678}};
const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
try{
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition(success,error,options){assert.deepEqual(options,{enableHighAccuracy:true,timeout:10000});gps.push({success,error});}}}});
 mount();startGps().success(position);assert.deepEqual(picked,[{lat:40.123457,lng:49.123457}]);unmount();
 mount();const stale=startGps();revision++;stale.success(position);assert.deepEqual(picked,[],'A parent synchronous revision invalidates GPS even before React effects flush');unmount();
 mount();const first=startGps(),second=startGps();first.success(position);first.error();assert.deepEqual(picked,[]);second.success(position);assert.equal(picked.length,1);unmount();
 mount();const disabled=startGps();render({disabled:true});disabled.success(position);assert.deepEqual(picked,[],'Disabled selection cannot be overwritten');unmount();
 mount();const gone=startGps();unmount();const before=writes;gone.success(position);gone.error();assert.deepEqual(picked,[]);assert.equal(writes,before,'Unmounted GPS callbacks do not write state');
 mount();const failed=startGps();revision++;const beforeFailure=writes;failed.error();assert.equal(writes,beforeFailure,'Stale GPS errors do not replace newer selection status');unmount();
}finally{
 if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete globalThis.navigator;
}

const pickerSource=await readFile('app/delivery-location-picker.tsx','utf8'),checkoutSource=await readFile('app/cart-sheet.tsx','utf8');
assert.ok(checkoutSource.includes('selectionVersion={()=>locationRun.current}'),'Cart passes the synchronous address/pin revision to the picker');
const invalidate=checkoutSource.match(/function invalidateQuote\(\)\{([^}]+)\}/)?.[1];assert.ok(invalidate?.includes('locationRun.current++'));assert.ok(invalidate.indexOf('locationRun.current++')<invalidate.indexOf('setQuote('),'Revision invalidation is synchronous, before state/effect updates');
assert.match(checkoutSource,/onChange=\{e=>\{setAddress\(e\.target\.value\);setPin\(null\);invalidateQuote\(\);\}\}/,'Typing a manual address invalidates the pending map selection and quote');
assert.ok(pickerSource.includes("String(latestVersion.current?.()??0)+'|'"),'Autocomplete compares the parent synchronous revision, not only delayed props');
assert.ok(pickerSource.includes("widget.setAttribute('aria-label',t('Google-da ünvan axtarın'))"),'Changing language updates the accessible name as well as the placeholder');

// Every new setup/search label must have five nonempty translations, be wired
// into the live language module, and not shadow any pre-existing dictionary key.
const languageSource=await readFile('lib/language.tsx','utf8'),languageTree=ts.createSourceFile('lib/language.tsx',languageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const oldKeys=new Set();
function collectRows(tree){function scan(node){if(ts.isArrayLiteralExpression(node)&&node.elements.length===5&&node.elements.every(ts.isStringLiteral))oldKeys.add(node.elements[0].text);ts.forEachChild(node,scan);}scan(tree);}
collectRows(languageTree);
let wiredImport=false,wiredSpread=false;
for(const node of languageTree.statements)if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text.endsWith('-translations')){
 const path='lib/'+node.moduleSpecifier.text.replace(/^\.\//,'')+'.ts';
 if(node.moduleSpecifier.text==='./google-maps-translations'){wiredImport=node.importClause?.namedBindings?.getText(languageTree).includes('googleMapsTranslations')===true;continue;}
 collectRows(ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true));
}
for(const row of (await load('lib/desktop-translations.ts')).desktopTranslations)oldKeys.add(row[0]);
function scanSpread(node){if(ts.isSpreadElement(node)&&node.expression.getText(languageTree)==='googleMapsTranslations')wiredSpread=true;ts.forEachChild(node,scanSpread);}scanSpread(languageTree);
assert.equal(wiredImport,true);assert.equal(wiredSpread,true,'New Google Maps rows are included in the runtime dictionary');
const {googleMapsTranslations}=await load('lib/google-maps-translations.ts'),translated=new Set(oldKeys);
for(const row of googleMapsTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()),'All five Google Maps translations: '+row[0]);assert.equal(translated.has(row[0]),false,'Google Maps cannot shadow an old or repeated key: '+row[0]);translated.add(row[0]);}
const required=new Set();
for(const path of ['app/admin/store/google-maps-setup.tsx','app/delivery-location-picker.tsx']){
 const tree=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function literals(node){if(ts.isStringLiteral(node))required.add(node.text);else if(ts.isConditionalExpression(node)){literals(node.whenTrue);literals(node.whenFalse);}else ts.forEachChild(node,literals);}
 function scan(node){if(ts.isCallExpression(node)&&['t','text.current','setError','setSearchError'].includes(node.expression.getText(tree)))node.arguments.forEach(literals);ts.forEachChild(node,scan);}scan(tree);
}
for(const key of required)if(key)assert.ok(translated.has(key),'Untranslated Maps setup/search/error label: '+key);
console.log(`PASS: ${googleMapsTranslations.length} Google Maps rows cover all setup/picker labels in five languages without duplicate keys; dictionary wiring, synchronous cart revision, accessible language updates and real GPS callback cancellation.`);
console.log('PASS: current Google widget events, minimal field mask, five language mappings, valid/invalid addresses and coordinates, latest-result wins, manual address/pin revisions, blocked/destroyed/stale cancellation, import errors and provider errors. Mock-only: no Google requests, keys, billing, database or server.');
