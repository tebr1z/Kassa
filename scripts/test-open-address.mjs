import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import postcss from 'postcss';
import ts from 'typescript';

// Controlled React effects, native AbortSignal and real component handlers.
// No DOM service, map tile, Nominatim, Google, GPS or database request is made.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const code=ts.transpileModule(await readFile(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((code.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error),[],path);
 const loaded={exports:{}};new Function('require','module','exports',code.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
const bounds=await load('lib/azerbaijan-location.ts');
const contact=await load('lib/customer-contact.ts');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
function nodes(tree){if(!tree||typeof tree!=='object')return [];return [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];}
function text(tree){if(tree==null||tree===false)return '';if(typeof tree==='string'||typeof tree==='number')return String(tree);return [tree.props?.children].flat(Infinity).map(text).join(' ');}
function button(tree,label){const result=nodes(tree).find(node=>node.type==='button'&&text(node).includes(label));assert.ok(result,'Button: '+label);return result;}
function harness(){
 let hooks=[],cursor=0,effects=[],tree,writes=0;
 const react={
  useId:()=> 'open-address-fixture',
  useRef(initial){const index=cursor++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index];},
  useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{writes++;hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},
  useEffect(callback,deps){const index=cursor++,previous=hooks[index];if(!previous||deps.some((value,offset)=>value!==previous.deps[offset])){hooks[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();hooks[index].cleanup=callback();});}},
 };
 return {react,render(Component,props){cursor=0;tree=Component(props);for(const node of nodes(tree)){const ref=node.props?.ref;if(typeof node.type==='string'&&ref&&typeof ref==='object'&&!ref.current)ref.current={};}for(const effect of effects.splice(0))effect();return tree;},unmount(){for(const hook of hooks)hook?.cleanup?.();},get writes(){return writes;}};
}
const MapPlaceholder=()=>null,icons=new Proxy({},{get:()=>()=>null});
const originalFetch=globalThis.fetch,originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalResize=globalThis.ResizeObserver,originalFormData=globalThis.FormData,originalInput=globalThis.HTMLInputElement;
let gps=[],requests=[],language='az';
globalThis.fetch=(url,options={})=>{const work=deferred();requests.push({url:String(url),options,...work});return work.promise;};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition(success,error,options){assert.deepEqual(options,{enableHighAccuracy:true,timeout:10000});gps.push({success,error});}}}});
const base={pin:null,address:'Bakı, Nizami küçəsi 10',tileUrl:'https://tile.openstreetmap.org/{z}/{x}/{y}.png'};
async function picker(changes={}){
 const h=harness(),picked=[],addresses=[];let revision=0;
 const {default:Component}=await load('app/delivery-location-picker.tsx',{react:h.react,'lucide-react':icons,'@/lib/language':{useTranslations:()=>({t:value=>value,language})},'@/lib/azerbaijan-location':bounds,'./address-map':{AddressMap:MapPlaceholder},'./open-map.css':{}});
 let props={...base,onPick:point=>picked.push(point),onAddressPick:(label,point)=>addresses.push({label,point}),selectionVersion:()=>revision,...changes};
 return {...h,picked,addresses,render(change={}){props={...props,...change};return h.render(Component,props);},revision(){revision++;},get writes(){return h.writes;}};
}
const searchInput=tree=>nodes(tree).find(node=>node.type==='input');
function type(f,value){const tree=f.render();searchInput(tree).props.onChange({target:{value}});return f.render();}
function open(f){button(f.render(),'Xəritəni aç').props.onClick();return f.render();}
function startGps(f){button(f.render(),'Cari məkanım').props.onClick();return gps.at(-1);}
const place={label:'Bakı, Nizami küçəsi',lat:40.409312345,lng:49.86716789};
const success=places=>Response.json({places});
try{
 {
  requests=[];const f=await picker();const initial=f.render();assert.equal(nodes(initial).some(node=>node.type===MapPlaceholder),false);assert.equal(requests.length,0,'Closed picker connects to no provider/config endpoint');assert.equal(gps.length,0);
  open(f);type(f,'Nizami');assert.equal(requests.length,0,'Typing is not autocomplete');const tree=f.render();const click=button(tree,'Axtar').props.onClick;click();click();assert.equal(requests.length,1,'Synchronous guard stops duplicate search submissions');assert.equal(requests[0].url,'/api/places');assert.equal(requests[0].options.method,'POST');assert.deepEqual(JSON.parse(requests[0].options.body),{q:'Nizami',lang:'az'});
  requests[0].resolve(success([place,{...place,lat:0},{...place,lng:Infinity},null]));await flush();button(f.render(),place.label).props.onClick();assert.deepEqual(f.addresses,[{label:place.label,point:{lat:40.409312,lng:49.867168}}]);f.unmount();
 }
 {
  requests=[];const f=await picker();open(f);button(type(f,'First'),'Axtar').props.onClick();const first=requests[0];button(type(f,'Second'),'Axtar').props.onClick();const second=requests[1];assert.equal(first.options.signal.aborted,true);
  second.resolve(success([{...place,label:'Latest address'}]));await flush();first.resolve(success([{...place,label:'Old address'}]));await flush();assert.ok(text(f.render()).includes('Latest address'));assert.ok(!text(f.render()).includes('Old address'));f.unmount();
 }
 for(const failure of [false,true]){
  requests=[];const f=await picker();open(f);button(type(f,'Nizami'),'Axtar').props.onClick();f.revision();if(failure)requests[0].reject(Error('Old provider error'));else requests[0].resolve(success([place]));await flush();const tree=f.render();assert.equal(nodes(tree).some(node=>node.type==='ul'),false);assert.ok(!text(tree).includes('Old provider error'));assert.deepEqual(f.addresses,[]);f.unmount();
 }
 {
  requests=[];const f=await picker();open(f);button(type(f,'Nizami'),'Axtar').props.onClick();requests[0].resolve(success([place]));await flush();const tree=f.render();f.revision();button(tree,place.label).props.onClick();assert.deepEqual(f.addresses,[],'A result already displayed cannot overwrite a newer manual edit');assert.match(text(f.render()),/Ünvan dəyişib/);f.unmount();
 }
 for(const [status,error]of [[429,'Ünvan axtarışı məşğuldur. Bir az sonra yenidən cəhd edin.'],[503,'Ünvan axtarışı hazırda əlçatan deyil. Ünvanı əl ilə yazın və xəritədə nöqtə seçin.']]){
  requests=[];const f=await picker();open(f);button(type(f,'Nizami'),'Axtar').props.onClick();requests[0].resolve(Response.json({error},{status}));await flush();assert.ok(text(f.render()).includes(error));assert.deepEqual(f.addresses,[]);f.unmount();
 }
 {
  requests=[];const f=await picker();open(f);button(type(f,'Nizami'),'Axtar').props.onClick();requests[0].resolve(success([]));await flush();assert.ok(text(f.render()).includes('Bu axtarışla ünvan tapılmadı.'));f.unmount();
 }
 {
  requests=[];const f=await picker();open(f);button(type(f,'Nizami'),'Axtar').props.onClick();const work=requests[0];f.unmount();const before=f.writes;assert.equal(work.options.signal.aborted,true);work.resolve(success([place]));await flush();assert.equal(f.writes,before,'Unmounted searches never write state');
 }
 {
  requests=[];language='ru';const f=await picker();open(f);button(type(f,'Баку'),'Axtar').props.onClick();assert.equal(JSON.parse(requests[0].options.body).lang,'ru');language='en';f.render();requests[0].resolve(success([place]));await flush();assert.equal(nodes(f.render()).some(node=>node.type==='ul'),false,'Changing language invalidates pending search results');f.unmount();language='az';
 }
 {
  requests=[];const f=await picker({tileUrl:undefined});assert.equal(requests.length,0);open(f);assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/delivery-settings');assert.equal(nodes(f.render()).some(node=>node.type===MapPlaceholder),false,'Wait for runtime tile configuration before loading any tiles');requests[0].resolve(Response.json({settings:{tileUrl:'https://example.test/tiles/{z}/{x}/{y}.png'}}));await flush();const tree=f.render();assert.equal(nodes(tree).find(node=>node.type===MapPlaceholder).props.tileUrl,'https://example.test/tiles/{z}/{x}/{y}.png');button(tree,'Xəritəni bağla').props.onClick();open(f);assert.equal(requests.length,1,'Successful runtime config is reused when reopening');f.unmount();
 }
 {
  requests=[];const f=await picker({tileUrl:undefined});open(f);requests[0].reject(Error('Configuration unavailable'));await flush();assert.equal(nodes(f.render()).some(node=>node.type===MapPlaceholder),true,'Config failure preserves default OSM map and manual address fallback');f.unmount();
 }
 {
  gps=[];const f=await picker();startGps(f).success({coords:{latitude:place.lat,longitude:place.lng}});assert.deepEqual(f.picked,[{lat:40.409312,lng:49.867168}]);assert.deepEqual(f.addresses,[],'GPS never reverse-geocodes or overwrites typed address');f.unmount();
 }
 for(const changed of ['revision','disabled','new-gps','unmount','map']){
  gps=[];requests=[];const f=await picker();const first=startGps(f);
  if(changed==='revision')f.revision();else if(changed==='disabled')f.render({disabled:true});else if(changed==='new-gps')startGps(f);else if(changed==='unmount')f.unmount();else{const tree=open(f);nodes(tree).find(node=>node.type===MapPlaceholder).props.onPick({lat:40.5,lng:49.8});}
  const before=f.picked.length;first.success({coords:{latitude:place.lat,longitude:place.lng}});first.error();assert.equal(f.picked.length,before,'Stale GPS cancelled after '+changed);assert.equal(requests.length,0,'Map/GPS does not reverse-geocode');f.unmount();
 }
 {
  gps=[];const f=await picker();startGps(f).success({coords:{latitude:0,longitude:0}});assert.deepEqual(f.picked,[]);assert.match(text(f.render()),/Azərbaycan daxilində/);f.unmount();
 }

 // Real AddressMap lifecycle, with a local Leaflet mock. Latest pin wins even
 // before the dynamic import resolves; null removes the old marker completely.
 async function mapFixture(props={}){
  const h=harness(),maps=[],markers=[],tiles=[],resizes=[],picked=[];
  const leaflet={
   map(box,options){const map={box,options,removed:0,views:[],events:{},center:{lat:40.4,lng:49.8},setView(center,zoom){this.views.push({center,zoom});return this;},on(name,callback){this.events[name]=callback;return this;},remove(){this.removed++;},invalidateSize(){this.invalidated=true;},getCenter(){return this.center;}};maps.push(map);return map;},
   tileLayer(url,options){const tile={url,options,events:{},on(name,callback){this.events[name]=callback;return this;},addTo(map){this.map=map;return this;}};tiles.push(tile);return tile;},
   circleMarker(point){const marker={point,removed:0,addTo(map){this.map=map;return this;},setLatLng(point){this.point=point;},remove(){this.removed++;}};markers.push(marker);return marker;},
  };
  globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;resizes.push(this);}observe(box){this.box=box;}disconnect(){this.disconnected=true;}};
  const {AddressMap:Component}=await load('app/address-map.tsx',{react:h.react,'lucide-react':icons,'@/lib/language':{useTranslations:()=>({t:value=>value,language:'az'})},'@/lib/azerbaijan-location':bounds,leaflet,'leaflet/dist/leaflet.css':{},'./open-map.css':{}});
  let current={pin:null,onPick:point=>picked.push(point),...props};return {...h,maps,markers,tiles,resizes,picked,render(changes={}){current={...current,...changes};return h.render(Component,current);},get writes(){return h.writes;}};
 }
 {
  const f=await mapFixture();f.render();f.render({pin:{lat:41,lng:49}});await flush();assert.equal(f.maps.length,1);assert.deepEqual(f.maps[0].views[0],{center:[41,49],zoom:16});assert.equal(f.markers.length,1);assert.equal(f.tiles[0].url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');assert.match(f.tiles[0].options.attribution,/openstreetmap.org\/copyright/);assert.equal(f.tiles[0].options.referrerPolicy,'strict-origin-when-cross-origin');
  f.render({pin:null});assert.equal(f.markers[0].removed,1,'Clearing a manual address removes the old pin');f.maps[0].events.click({latlng:{lat:40.12345678,lng:49.12345678}});assert.deepEqual(f.picked,[{lat:40.123457,lng:49.123457}]);f.render({disabled:true});f.maps[0].events.click({latlng:{lat:40.4,lng:49.8}});assert.equal(f.picked.length,1);f.render({disabled:false});button(f.render(),'Xəritənin mərkəzini seç').props.onClick();assert.deepEqual(f.picked.at(-1),{lat:40.4,lng:49.8},'Keyboard users can select the map centre');f.resizes[0].callback();assert.equal(f.maps[0].invalidated,true);f.unmount();assert.equal(f.maps[0].removed,1);assert.equal(f.resizes[0].disconnected,true);const before=f.writes;f.tiles[0].events.tileerror();assert.equal(f.writes,before,'Late tile errors cannot write after cleanup');
 }
 {
  const f=await mapFixture();f.render();f.unmount();await flush();assert.equal(f.maps.length,0,'An import completing after unmount cannot construct a map');
 }
 {
  const f=await mapFixture();f.render();await flush();f.tiles[0].events.tileerror();assert.match(text(f.render()),/Xəritə şəkilləri yüklənmədi/);button(f.render(),'Yenidən yoxla').props.onClick();f.render();await flush();assert.equal(f.maps.length,2);assert.equal(f.maps[0].removed,1,'Retry removes the old map before recreating');f.unmount();
 }

 // Account integration uses identical picker guards; a manually entered optional
 // address remains saveable while the external search/map service is unavailable.
 {
  const h=harness(),ProfilePicker=()=>null;
  const {AccountSettings}=await load('app/account-settings.tsx',{react:h.react,'lucide-react':icons,'./delivery-location-picker':{default:ProfilePicker,__esModule:true},'@/lib/language':{useTranslations:()=>({t:value=>value})},'@/lib/customer-contact':contact,'@/lib/azerbaijan-location':bounds});
  const user={id:'customer',name:'Aysel Əliyeva',email:'fixture@example.test',phone:'0501234567',address:'Bakı, Nizami küçəsi 10',lat:40.4,lng:49.8};const render=()=>h.render(AccountSettings,{user,onSaved:async()=>{}});
  let tree=render(),control=nodes(tree).find(node=>node.type===ProfilePicker),version=control.props.selectionVersion();const originalAddress=nodes(tree).find(node=>node.type==='textarea').props.value;control.props.onPick({lat:40.5,lng:49.9});tree=render();assert.equal(nodes(tree).find(node=>node.type==='textarea').props.value,originalAddress,'Profile map/GPS changes only the pin');control=nodes(tree).find(node=>node.type===ProfilePicker);assert.ok(control.props.selectionVersion()>version);
  nodes(tree).find(node=>node.type==='textarea').props.onChange({target:{value:'Şəki, Mərkəz küçəsi 7'}});tree=render();assert.equal(nodes(tree).find(node=>node.type===ProfilePicker).props.pin,null,'Manual text clears stale coordinates');assert.equal(button(tree,'Ayarları saxla').props.disabled,false);
  globalThis.FormData=class{get(){return '';}};globalThis.HTMLInputElement=class{value='fixture-password';};const currentPassword=new globalThis.HTMLInputElement(),newPassword=new globalThis.HTMLInputElement();const form={elements:{namedItem:name=>name==='currentPassword'?currentPassword:newPassword}},event={preventDefault(){},currentTarget:form};
  requests=[];nodes(tree).find(node=>node.type==='textarea').props.onChange({target:{value:'aaaaaaaaa'}});await nodes(render()).find(node=>node.type==='form').props.onSubmit(event);assert.equal(requests.length,0,'Profile rejects garbage address locally');assert.match(text(render()),/Ünvanı düzgün yazın/);
  nodes(render()).find(node=>node.type==='textarea').props.onChange({target:{value:'Şəki, Mərkəz küçəsi 7'}});const saving=nodes(render()).find(node=>node.type==='form').props.onSubmit(event);assert.equal(requests.length,1);const payload=JSON.parse(requests[0].options.body);assert.equal(payload.address,'Şəki, Mərkəz küçəsi 7');assert.equal(payload.lat,null);assert.equal(payload.lng,null);assert.equal(nodes(render()).find(node=>node.type===ProfilePicker).props.disabled,true);
  requests[0].resolve(Response.json({error:'Hesab ayarları saxlanmadı.'},{status:503}));await saving;tree=render();assert.equal(button(tree,'Ayarları saxla').props.disabled,false,'Failed profile save recovers');assert.equal(nodes(tree).find(node=>node.type==='textarea').props.value,payload.address,'Failure retains the manual address');
  nodes(tree).find(node=>node.type==='textarea').props.onChange({target:{value:''}});const saved=nodes(render()).find(node=>node.type==='form').props.onSubmit(event);assert.equal(JSON.parse(requests[1].options.body).address,'','Optional blank address is not falsely rejected');requests[1].resolve(Response.json({ok:true}));await saved;assert.equal(currentPassword.value,'');assert.equal(newPassword.value,'');h.unmount();globalThis.FormData=originalFormData;if(originalInput)globalThis.HTMLInputElement=originalInput;else delete globalThis.HTMLInputElement;
 }
 {
  requests=[];const h=harness(),OriginPicker=()=>null,delivery=await load('lib/delivery.ts');
  const {default:DeliveryManager}=await load('app/admin/store/delivery-manager.tsx',{react:h.react,'lucide-react':icons,'@/lib/language':{useLanguage:()=> 'az',t:value=>value,languageAmount:value=>value.toFixed(2)},'@/lib/delivery':delivery,'@/lib/azerbaijan-location':bounds,'../../delivery-location-picker':{default:OriginPicker,__esModule:true},'./delivery-manager.css':{}});
  const settings={mode:'distance',minimumOrder:0,minimumFee:2,pricePerKm:1,freeDistanceKm:3,freeOrderFrom:30,originAddress:'Bakı, Mərkəz küçəsi 1',originLat:40.4,originLng:49.8,routingConfigured:true,tileUrl:base.tileUrl,browserKey:''};
  const render=()=>h.render(DeliveryManager,{});render();assert.equal(requests[0].url,'/api/admin/delivery');requests[0].resolve(Response.json({settings}));await flush();let tree=render();assert.equal(text(nodes(tree).find(node=>node.type==='output')),'2.00 AZN','Preview charges only distance beyond first 3 km');
  const field=(label,tree=render())=>nodes(tree).find(node=>node.type==='label'&&text(node).startsWith(label));
  nodes(field('İlk pulsuz məsafə')).find(node=>node.type==='input').props.onChange({target:{value:'5'}});assert.equal(text(nodes(render()).find(node=>node.type==='output')),'0.00 AZN','Free distance bypasses minimum fee');
  nodes(field('İlk pulsuz məsafə')).find(node=>node.type==='input').props.onChange({target:{value:'3'}});nodes(render()).find(node=>node.type==='input'&&node.props['aria-label']==='Nümunə məhsul cəmi').props.onChange({target:{value:'30'}});assert.equal(text(nodes(render()).find(node=>node.type==='output')),'0.00 AZN','Threshold uses product total and overrides distance fee');
  nodes(render()).find(node=>node.type==='input'&&node.props['aria-label']==='Nümunə məhsul cəmi').props.onChange({target:{value:'20'}});nodes(field('Pulsuz çatdırılma üçün sifariş məbləği')).find(node=>node.type==='input').props.onChange({target:{value:''}});tree=render();assert.equal(text(nodes(tree).find(node=>node.type==='output')),'2.00 AZN');
  const revision=nodes(tree).find(node=>node.type===OriginPicker).props.selectionVersion();nodes(tree).find(node=>node.type==='textarea').props.onChange({target:{value:'Şəki, Mərkəz küçəsi 7'}});tree=render();let origin=nodes(tree).find(node=>node.type===OriginPicker);assert.equal(origin.props.pin,null,'Editing origin text must not retain a stale route origin');assert.ok(origin.props.selectionVersion()>revision);assert.equal(requests.length,1,'Editing tariffs and origin makes no provider request');
  const event={preventDefault(){}};await nodes(tree).find(node=>node.type==='form').props.onSubmit(event);assert.equal(requests.length,1,'Cannot save distance mode with cleared origin pin');origin.props.onPick({lat:41.2,lng:47.2});tree=render();const saving=nodes(tree).find(node=>node.type==='form').props.onSubmit(event);assert.equal(requests.length,2);const payload=JSON.parse(requests[1].options.body);assert.equal(payload.originAddress,'Şəki, Mərkəz küçəsi 7');assert.equal(payload.originLat,41.2);assert.equal(payload.freeDistanceKm,3);assert.equal(payload.freeOrderFrom,null);assert.equal(Object.keys(payload).some(key=>/key|configured|tile/i.test(key)),false,'Admin save sends no keys or client-authoritative routing config');requests[1].resolve(Response.json({settings:{...settings,...payload},ok:true}));await saving;assert.equal(button(render(),'Çatdırılma ayarlarını saxla').props.disabled,true,'Successful save is clean');h.unmount();
 }
}finally{
 globalThis.fetch=originalFetch;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;if(originalResize)globalThis.ResizeObserver=originalResize;else delete globalThis.ResizeObserver;globalThis.FormData=originalFormData;if(originalInput)globalThis.HTMLInputElement=originalInput;else delete globalThis.HTMLInputElement;
}

const pickerSource=await readFile('app/delivery-location-picker.tsx','utf8'),mapSource=await readFile('app/address-map.tsx','utf8'),profileSource=await readFile('app/account-settings.tsx','utf8');
for(const code of [pickerSource,mapSource,profileSource])assert.doesNotMatch(code,/maps\.googleapis|unpkg\.com|attachGoogleAddressSearch|\/api\/places\?lat=|setInterval/,'No Google/CDN/reverse/autocomplete timers in shared customer location flow');
assert.match(mapSource,/import\('leaflet'\)/);assert.doesNotMatch(mapSource,/L\.marker\(/,'Circle marker needs no remotely loaded icon assets');
assert.match(profileSource,/customerAddressError\(address,\{required:false,maxLength:300\}\)/);
postcss.parse(await readFile('app/open-map.css','utf8'));

const {openMapTranslations}=await load('lib/open-map-translations.ts');
const languageSource=await readFile('lib/language.tsx','utf8'),tree=ts.createSourceFile('lib/language.tsx',languageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),allKeys=new Set();
function rows(node){if(ts.isArrayLiteralExpression(node)&&node.elements.length===5&&node.elements.every(ts.isStringLiteral))allKeys.add(node.elements[0].text);ts.forEachChild(node,rows);}rows(tree);
for(const node of tree.statements)if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text.endsWith('-translations')&&node.moduleSpecifier.text!=='./open-map-translations'){
 const path='lib/'+node.moduleSpecifier.text.replace(/^\.\//,'')+'.ts';rows(ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true));
}
for(const row of (await load('lib/desktop-translations.ts')).desktopTranslations)allKeys.add(row[0]);
for(const row of openMapTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));assert.equal(allKeys.has(row[0]),false,'New map key cannot shadow existing translations: '+row[0]);allKeys.add(row[0]);}
assert.match(languageSource,/import\s*\{openMapTranslations\}\s*from\s*['"]\.\/open-map-translations['"]/);assert.match(languageSource,/\.\.\.openMapTranslations/);
for(const path of ['app/delivery-location-picker.tsx','app/address-map.tsx','app/admin/store/delivery-manager.tsx']){
 const source=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),keys=new Set();
 function literal(node){if(ts.isStringLiteral(node))keys.add(node.text);else if(ts.isConditionalExpression(node)){literal(node.whenTrue);literal(node.whenFalse);}}
 function scan(node){if(ts.isCallExpression(node)&&['t','setError'].includes(node.expression.getText(source)))node.arguments.forEach(literal);ts.forEachChild(node,scan);}scan(source);
 for(const key of keys)if(key)assert.ok(allKeys.has(key),'Five-language map string: '+key);
}
console.log('PASS: opt-in bundled OSM maps; submit-only localized search; duplicate/abort/stale/manual/disabled/unmounted guards; no reverse geocoding; AZ point guard; provider/manual fallback; runtime tiles; marker clearing, keyboard centre selection and map cleanup; profile integration; five-language coverage. Mock-only: no external services.');
