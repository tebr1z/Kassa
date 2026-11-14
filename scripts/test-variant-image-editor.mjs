import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import postcss from 'postcss';

// Runs the actual editor's handlers/effects with local mock transport. No real
// uploads, cloud credentials, live products, database or image writes are used.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const compiled=ts.transpileModule(await readFile(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[],path);
 const result={exports:{}};new Function('require','module','exports',compiled.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),result,result.exports);return result.exports;
}
const variant=await load('lib/variant-draft.ts'),image=await load('lib/product-option-image.ts');
const {variantDraft,serializeVariants}=variant;
const cloud='https://res.cloudinary.com/example/image/upload/red.webp',local='/api/catalog-media/'+'a'.repeat(64),desktop='/api/desktop-media/'+'b'.repeat(64);
const choice=(id,color='Qırmızı',size='40 sm',image_url)=>variantDraft({id,label:'',size,color,kind:'Dəmir',price:'7',cost_price:'3',position:2,is_active:true,attributes:{Qalınlıq:'2 mm'},...(image_url!==undefined?{image_url}:{})});
const base=choice('3b56e36c-c8c0-4664-86a9-e4a77b8e8111');
for(const url of [cloud,local,desktop,'']){
 const row=variantDraft({...base,image_url:url});assert.equal(row.image_url,url);assert.equal(serializeVariants([row])[0].image_url,url,'Drafting and serialization preserve an image or an explicit removal');
}
assert.equal(Object.hasOwn(serializeVariants([base])[0],'image_url'),false,'No image field is sent when older callers never supplied one');
assert.equal(serializeVariants([{...base,id:'draft-test',image_url:cloud}])[0].id,undefined);
assert.deepEqual(serializeVariants([{...base,image_url:local}])[0].attributes,{Qalınlıq:'2 mm'});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<30;index++)await Promise.resolve();};
function nodes(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
function text(node){return node==null||node===false?'':typeof node==='string'||typeof node==='number'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');}
const rows=tree=>nodes(tree).filter(node=>node.type==='div'&&node.props.className==='variant-row');
const files=tree=>nodes(tree).filter(node=>node.type==='input'&&node.props.type==='file');
function button(tree,label){const found=nodes(tree).find(node=>node.type==='button'&&text(node).includes(label));assert.ok(found,label);return found;}
function selected(input,file){const target={files:file?[file]:[],value:'C:\\fakepath\\'+(file?.name||'')};input.props.onChange({currentTarget:target});assert.equal(target.value,'','Picker resets so the same file can be selected again');}
const png=()=>new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])],'red.png',{type:'image/png'});
let requests=[];
const nativeFetch=globalThis.fetch;
globalThis.fetch=(url,options={})=>{const task=deferred();requests.push({url,options,...task});return task.promise;};
async function fixture(options=[base],extra={}){
 let hooks=[],cursor=0,effects=[],writes=0;
 const changes=[],busy=[];
 const props={options,canManageImages:true,onChange(next){props.options=next;changes.push(next);},onUploadBusyChange(value){busy.push(value);},...extra};
 const react={useRef(initial){const index=cursor++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index];},useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{writes++;hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},useEffect(callback,deps){const index=cursor++,previous=hooks[index];if(!previous||deps.some((value,offset)=>value!==previous.deps[offset])){hooks[index]={deps};effects.push(()=>{previous?.cleanup?.();hooks[index].cleanup=callback();});}}};
 react.useLayoutEffect=react.useEffect;
 const {default:Editor}=await load('app/admin/store/variant-editor.tsx',{react,'lucide-react':new Proxy({},{get:()=>()=>null}),'@/lib/variant-draft':variant,'@/lib/product-option-image':image,'@/lib/language':{useTranslations:()=>({t:value=>value})},'./variant-editor.css':{}});
 requests=[];
 return {props,changes,busy,render(){cursor=0;const tree=Editor(props);for(const effect of effects.splice(0))effect();return tree;},unmount(){for(const hook of hooks)hook?.cleanup?.();},get writes(){return writes;}};
}

try{
 {
  const f=await fixture([choice(base.id,'Qırmızı','40 sm',cloud)],{canManageImages:false}),tree=f.render();
  assert.equal(files(tree).length,0);assert.doesNotMatch(text(tree),/Seçim şəkli/);assert.equal(serializeVariants(f.props.options)[0].image_url,cloud);assert.equal(requests.length,0);f.unmount();
 }
 {
  const f=await fixture([choice(base.id,'Qırmızı','40 sm',cloud)]),tree=f.render(),photo=nodes(tree).find(node=>node.type==='img');
  assert.equal(photo.props.src,cloud);assert.match(photo.props.alt,/Qırmızı/);assert.equal(photo.props.referrerPolicy,'no-referrer');
  button(tree,'Seçim şəklini sil').props.onClick();assert.equal(f.props.options[0].image_url,'');assert.equal(serializeVariants(f.props.options)[0].image_url,'');assert.equal(requests.length,0,'Removing an option association never deletes a shared upload or writes the main photo');f.unmount();
 }
 {
  const f=await fixture(),tree=f.render(),input=files(tree)[0],staleRemove=button(tree,'Seçimi sil').props.onClick;
  selected(input,png());selected(input,png());staleRemove();assert.equal(requests.length,1,'Repeated upload and stale row-delete handlers are blocked synchronously');assert.equal(f.changes.length,0);assert.deepEqual(f.busy,[true]);
  const work=requests[0];assert.equal(work.url,'/api/store-admin/upload');assert.equal(work.options.method,'POST');assert.equal(work.options.body.get('purpose'),'variant');assert.ok(work.options.body.get('file') instanceof File);assert.deepEqual([...work.options.body.keys()].sort(),['file','purpose'],'Never supplies productId/categoryId or logo/main-photo targets');assert.equal(work.options.headers,undefined,'Browser generates the multipart boundary');
  for(const node of nodes(f.render()).filter(node=>['button','input'].includes(node.type)))assert.equal(node.props.disabled,true,'Editor locks all actions while photo upload is in progress');
  const updated={...f.props.options[0],price:'19',attributes:{Qalınlıq:'3 mm'}};f.props.options=[updated];f.render();
  work.resolve(Response.json({url:local}));await flush();assert.deepEqual(f.busy,[true,false]);assert.equal(f.props.options[0].image_url,local);assert.equal(f.props.options[0].price,'19');assert.deepEqual(f.props.options[0].attributes,{Qalınlıq:'3 mm'},'Async image merge preserves latest unrelated field changes');assert.match(text(f.render()),/məhsulu saxlayın/i);f.unmount();
 }
 {
  const red=choice(base.id,'Qırmızı','40 sm',cloud),same=choice('red-50',' QIRMIZI ','50 sm'),black=choice('black','Qara','40 sm',local);
  const f=await fixture([red,same,black]),tree=f.render();button(rows(tree)[0],'Eyni rəngə tətbiq et').props.onClick();
  assert.equal(f.props.options[0].image_url,cloud);assert.equal(f.props.options[1].image_url,cloud);assert.deepEqual(f.props.options[2],black,'Copy is strictly scoped to the exact normalised colour');assert.deepEqual(f.props.options[1].attributes,same.attributes);assert.equal(f.props.options[1].price,same.price);assert.equal(f.props.options[1].size,'50 sm');assert.equal(requests.length,0);f.unmount();
 }
 {
  const f=await fixture([choice(base.id,'','40 sm',cloud),choice('blank','','50 sm')]),tree=f.render();assert.equal(nodes(tree).filter(node=>node.type==='button'&&text(node).includes('Eyni rəngə tətbiq et')).length,0,'Empty colours never create a broad image copy action');f.unmount();
 }
 {
  const f=await fixture(),input=files(f.render())[0];
  for(const file of [new File(['x'],'vector.svg',{type:'image/svg+xml'}),new File([],'empty.png',{type:'image/png'}),{size:4000001,type:'image/png',name:'huge.png'},new File(['x'],'bad.txt',{type:'text/plain'})]){selected(input,file);assert.equal(requests.length,0);assert.match(text(f.render()),/maksimum 4 MB/);}
  selected(files(f.render())[0],new File(['bytes'],'camera.jpg'));assert.equal(requests.length,1,'Camera files with empty browser MIME type can be checked by the server');requests[0].resolve(Response.json({url:desktop}));await flush();assert.equal(f.props.options[0].image_url,desktop);f.unmount();
 }
 for(const result of [{url:'javascript:alert(1)'},{url:'https://evil.example/red.png'},{url:'data:image/png;base64,xxx'},{url:'/api/admin/export'},{url:'https://res.cloudinary.com@evil.example/red.png'},{url:cloud+'\n'},{url:''},{}]){
  const f=await fixture();selected(files(f.render())[0],png());requests[0].resolve(Response.json(result));await flush();assert.equal(f.changes.length,0,'Malformed upload response cannot produce an unsafe preview or save');assert.match(text(f.render()),/yüklənməsi alınmadı/);assert.deepEqual(f.busy,[true,false]);f.unmount();
 }
 for(const status of [401,403,413,500]){
  const f=await fixture();selected(files(f.render())[0],png());requests[0].resolve(Response.json({error:'secret provider data MUST NEVER APPEAR'},{status}));await flush();assert.equal(f.changes.length,0);assert.doesNotMatch(text(f.render()),/secret provider data/);assert.ok(nodes(f.render()).some(node=>node.props?.role==='alert'));assert.deepEqual(f.busy,[true,false]);assert.equal(files(f.render())[0].props.disabled,false);f.unmount();
 }
 for(const fail of [new TypeError('secret network details'),new SyntaxError('secret body')]){
  const f=await fixture();selected(files(f.render())[0],png());requests[0].reject(fail);await flush();assert.equal(f.changes.length,0);assert.doesNotMatch(text(f.render()),/secret/);assert.match(text(f.render()),/Yenidən cəhd edin/);assert.deepEqual(f.busy,[true,false]);f.unmount();
 }
 {
  const f=await fixture();selected(files(f.render())[0],png());const work=requests[0];f.props.options=[];f.render();assert.equal(work.options.signal.aborted,true);assert.deepEqual(f.busy,[true,false]);work.resolve(Response.json({url:cloud}));await flush();assert.equal(f.changes.length,0,'Deleted/replaced option is never resurrected by a late upload');f.unmount();
 }
 {
  const f=await fixture();selected(files(f.render())[0],png());const work=requests[0];f.props.options=[{...base,image_url:local}];f.render();assert.equal(work.options.signal.aborted,true);work.resolve(Response.json({url:cloud}));await flush();assert.equal(f.changes.length,0,'Late upload does not overwrite a newer photo association');assert.equal(f.props.options[0].image_url,local);f.unmount();
 }
 {
  const f=await fixture();selected(files(f.render())[0],png());const work=requests[0];f.props.canManageImages=false;f.render();assert.equal(work.options.signal.aborted,true);work.resolve(Response.json({url:cloud}));await flush();assert.equal(f.changes.length,0);assert.deepEqual(f.busy,[true,false]);f.unmount();
 }
 {
  const f=await fixture();selected(files(f.render())[0],png());const work=requests[0];f.unmount();const before=f.writes;assert.equal(work.options.signal.aborted,true);assert.deepEqual(f.busy,[true,false]);work.resolve(Response.json({url:cloud}));await flush();assert.equal(f.changes.length,0);assert.equal(f.writes,before,'Late upload does not set state or mutate a closed form');assert.deepEqual(f.busy,[true,false]);
 }
 {
  const f=await fixture([base],{busy:true}),tree=f.render();selected(files(tree)[0],png());assert.equal(requests.length,0,'Saving/busy editor never starts an image upload');f.unmount();
 }
 for(const unsafe of ['javascript:alert(1)','https://evil.example/a.png','data:image/png;base64,xxx']){
  const f=await fixture([{...base,image_url:unsafe}]);assert.equal(nodes(f.render()).filter(node=>node.type==='img').length,0,'Old malformed rows never mount arbitrary image URLs');f.unmount();
 }
}finally{globalThis.fetch=nativeFetch;}

const source=await readFile('app/admin/store/variant-editor.tsx','utf8'),css=await readFile('app/admin/store/variant-editor.css','utf8');postcss.parse(css);assert.match(css,/focus-visible/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/max-width:540px/);
assert.doesNotMatch(source,/localStorage|sessionStorage|console\.|process\.env/);
const {variantImageTranslations}=await load('lib/variant-image-translations.ts');
const keys=new Set(),tree=ts.createSourceFile('variant-editor.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
for(const row of variantImageTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()),row[0]);assert.equal(keys.has(row[0]),false,'Unique translation key');keys.add(row[0]);}
function literals(node){if(ts.isStringLiteral(node))assert.ok(keys.has(node.text),'New image UI has five-language copy: '+node.text);else if(ts.isConditionalExpression(node)){literals(node.whenTrue);literals(node.whenFalse);}}
function walk(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='t')node.arguments.forEach(literals);if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='text')literals(node.initializer);ts.forEachChild(node,walk);}walk(tree);
console.log('PASS: variant photo drafting, omitted vs explicit clear, admin-only picker, fixed upload purpose without main/logo writes, safe preview URLs, synchronous upload/save-busy signalling, duplicate/stale action guards, exact-colour copy, bounded raster files, latest-row merges, safe failures, unmount/remove/role-change aborts and five-language responsive UI. No live or cloud access.');
