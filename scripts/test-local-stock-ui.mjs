import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import postcss from 'postcss';

// Isolated real UI functions, hook snapshots and native-form payload helpers.
// No server, database, customer record, desktop files or live credentials used.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const compiled=ts.transpileModule(await readFile(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[],path);
 const compiledModule={exports:{}};new Function('require','module','exports',compiled.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),compiledModule,compiledModule.exports);return compiledModule.exports;
}
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const mode=await load('lib/staff-workspace-mode.ts'),draft=await load('lib/variant-draft.ts');
const payload=await load('lib/catalog-editor-payload.ts',{'./variant-draft':draft});
const {staffPermissions}=await load('lib/staff-access.ts');
const roles=['admin','manager','cashier','warehouse','accountant','online_manager','online_assistant'];
const blocked=['Satış / POS','Məhsullar','Anbar','Sifarişlər','Satınalma','Maliyyə','Hesabatlar','Nəzarət jurnalı','Mağazalar və kassirlər'];
for(const role of roles){
 const user={permissions:staffPermissions(role)};
 for(const local of [false,undefined]){
  for(const section of blocked)assert.equal(mode.canOpenWorkspaceSection({local,user},section),false,role+' web must not expose '+section);
  assert.equal(mode.canOpenWorkspaceSection({local,user},'İdarə paneli'),true,'Every staff role can read the non-operational web welcome');
 }
 for(const section of blocked)assert.equal(mode.canOpenWorkspaceSection({local:true,user},section),user.permissions.includes('*')||user.permissions.includes(section),'Local mode preserves the existing role permission, not a blanket grant');
}
assert.equal(mode.canOpenWorkspaceSection({local:false,user:{permissions:['*']}},'Tənzimləmələr'),true);
assert.equal(mode.canOpenWorkspaceSection({local:false,user:{permissions:['*']}},'Dəstək biletləri'),true);
assert.equal(mode.canOpenWorkspaceSection({local:false,user:{permissions:['Satış / POS']}},'Tənzimləmələr'),false);

const source=await readFile('app/admin/staff-dashboard.tsx','utf8'),ast=ts.createSourceFile('staff-dashboard.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),home=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Home');assert.ok(home?.body);
const initial=home.body.statements.find(node=>ts.isExpressionStatement(node)&&node.getText(ast).startsWith('useEffect(')&&node.getText(ast).includes('void loadProducts()'));assert.ok(initial);
const runInitial=new Function('auth','useEffect','loadProducts','loadDashboard','staffPortalPath','window',compile(initial.getText(ast)));
for(const role of roles)for(const local of [false,undefined,true]){
 const calls=[];
 runInitial({authenticated:true,local,user:{role,id:'fixture'}},fn=>fn(),()=>calls.push('products'),()=>calls.push('dashboard'),value=>'/staff'+value,{location:{replace:value=>{assert.equal(value,'/staff/online');calls.push('online');}}});
 const expected=role.startsWith('online_')?['online']:local===true?({admin:['products','dashboard'],manager:['products','dashboard'],cashier:['products','dashboard'],warehouse:['products']}[role]||[]):[];
 assert.deepEqual(calls,expected,role+' '+local+' only requests available operational data');
}
for(const name of ['loadProducts','loadDashboard']){
 const fn=home.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn);
 let requests=0;
 const run=new Function('auth','fetch','setDataStatus','setProductList','setDashboard','setDashboardError','archivedProductIds',compile(fn.getText(ast))+'return '+name+'();');
 for(const local of [false,undefined])await run({local},async()=>{requests++;throw Error('Forbidden web inventory fetch');},()=>{},()=>{},()=>{},()=>{},{current:new Set()});
 assert.equal(requests,0,name+' itself refuses web calls, not only the initial effect');
}
for(const view of ['PosView','InventoryView','OrdersView','PurchasingView','ReportsView','AuditView','LocationsPanel','FinanceOverview']){
 let found=false;function scan(node){if(ts.isJsxExpression(node)&&node.expression&&node.expression.getText(ast).includes('<'+view)&&node.expression.getText(ast).startsWith('auth.local===true&&'))found=true;ts.forEachChild(node,scan);}scan(home);assert.ok(found,view+' cannot mount or fetch in web mode');
}
assert.match(source,/auth\.local===true\?<>\s*<DesktopConnection\/><SettingsView\/><\/>:<WebSettings\/>/);
assert.match(source,/canReadProductData=auth\.local===true/);assert.doesNotMatch(source,/Veb kassası ayrıca baza ilə işləyir/);

const variant=draft.variantDraft({id:'11111111-1111-4111-8111-111111111111',label:'',size:'40 sm',color:'Qara',kind:'Dəmir',price:20,cost_price:9,image_url:'https://res.cloudinary.com/test/image/upload/black.webp',is_active:true,attributes:{Qalınlıq:'2 mm'}});
const form={name:'Veb manqal',sku:'PUBLIC-40',category:'Manqallar',unit:'ədəd',sale_price:'25',discount_price:'20',is_active:'on',description:'Məhsul',specifications:'Dəmir',cost_price:'999',stock:'123456',min_stock:'999',barcode:'PRIVATE-BARCODE',unknown:'not forwarded'};
const web=payload.catalogEditorPayload(form,{local:false,options:[variant]});
for(const key of ['cost_price','stock','min_stock','barcode','unknown'])assert.equal(Object.hasOwn(web,key),false,'Web payload omits '+key);
assert.equal(Object.hasOwn(web.options[0],'cost_price'),false);assert.equal(web.options[0].image_url,variant.image_url);assert.deepEqual(web.options[0].attributes,variant.attributes);assert.equal(web.sale_price,25);assert.equal(web.discount_price,20);
const local=payload.catalogEditorPayload(form,{local:true,options:[variant]});assert.equal(local.cost_price,999);assert.equal(local.barcode,'PRIVATE-BARCODE');assert.equal(local.options[0].cost_price,9);
assert.equal(Object.hasOwn(draft.serializeVariants([variant],{includeCosts:false})[0],'cost_price'),false);
assert.equal(draft.serializeVariants([variant])[0].cost_price,9,'Default local serialization remains backward compatible');
assert.doesNotThrow(()=>draft.serializeVariants([{...variant,cost_price:'not a web field'}],{includeCosts:false}),'Hidden/irrelevant cost fields do not prevent web catalogue edits');

function nodes(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
function text(node){return node==null||node===false?'':typeof node==='string'||typeof node==='number'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');}
const Dummy=()=>null,icons=new Proxy({},{get:()=>Dummy}),language={t:value=>value,useLanguage:()=>{},useTranslations:()=>({t:value=>value})};
const {default:Welcome}=await load('app/admin/web-workspace.tsx',{'lucide-react':icons,'@/lib/language':language,'@/lib/staff-portal':{staffPortalPath:value=>'/staff'+value},'./web-workspace.css':{}});
for(const role of roles){
 const tree=Welcome({role,onSupport(){}}),links=nodes(tree).filter(node=>typeof node.props?.href==='string').map(node=>node.props.href);
 assert.match(text(tree),/Stok yalnız masaüstü tətbiqdə saxlanılır/);assert.doesNotMatch(text(tree),/0 ₼|Ümumi qalıq|Baza açılmadı|yüklənir/);
 assert.ok(links.includes('/'));assert.equal(links.includes('/staff/store'),role==='admin');assert.equal(links.includes('/staff/online'),['admin','manager'].includes(role));
 assert.equal(nodes(tree).some(node=>node.type==='button'),role==='admin','Only administrator receives the support inbox action');
}
const fakeReact=(states={})=>{let cursor=0;return {useState(initial){const index=cursor++;return [Object.hasOwn(states,index)?states[index]:typeof initial==='function'?initial():initial,()=>{}];},useRef:value=>({current:value}),useEffect(){},useLayoutEffect(){},useCallback:fn=>fn};};
const product={...form,id:'11111111-1111-4111-8111-111111111111',is_active:true,image_url:'',options:[variant]};
for(const local of [false,true]){
 const data={local,canManageProducts:true,products:[product],coupons:[],messages:[]};
 const {default:Commerce}=await load('app/admin/store/commerce-manager.tsx',{react:fakeReact({0:data,6:product,8:[variant]}),'@/lib/language':language,'@/lib/staff-portal':{staffPortalPath:value=>'/staff'+value},'./commerce-admin.css':{},'./variant-editor':Dummy,'../product-discount-editor':Dummy,'../product-delete-dialog':Dummy,'../use-product-removal':{ProductRemovalNotice:Dummy,useProductRemoval:rows=>({rows,notice:'',isRemoving:()=>false,clearNotice(){}})},'@/lib/variant-draft':draft,'@/lib/catalog-editor-payload':payload});
 const tree=Commerce(),all=nodes(tree);
 for(const name of ['cost_price','barcode'])assert.equal(all.some(node=>node.type==='input'&&node.props.name===name),local,'CMS '+name+' field only exists locally');
 assert.equal(text(tree).includes('123456'),local,'Web cards never print stock even if an old response accidentally supplies it');assert.equal(text(tree).includes('PRIVATE-BARCODE'),local);
 const editor=all.find(node=>node.type===Dummy&&Object.hasOwn(node.props,'canManageCosts'));assert.ok(editor);assert.equal(editor.props.canManageCosts,local);assert.equal(editor.props.canManageImages,true);
 assert.ok(all.some(node=>node.type==='button'&&text(node)==='Məhsulu sil'),'Web catalogue deletion remains available');assert.ok(all.some(node=>node.type==='input'&&node.props.type==='file'),'Main product photos remain editable');
}
for(const canManageCosts of [false,true]){
 const image=await load('lib/product-option-image.ts');
 const {default:Editor}=await load('app/admin/store/variant-editor.tsx',{react:fakeReact(),'@/lib/language':language,'@/lib/variant-draft':draft,'@/lib/product-option-image':image,'lucide-react':icons,'./variant-editor.css':{}});
 const tree=Editor({options:[variant],onChange(){},canManageImages:true,canManageCosts}),all=nodes(tree);
 assert.equal(all.some(node=>node.type==='input'&&String(node.props['aria-label']||'').startsWith('Seçimin alış qiyməti')),canManageCosts);
 assert.ok(all.some(node=>node.type==='input'&&node.props.type==='file'),'Per-colour photo upload is still present');assert.equal(text(tree).includes('Variantlar məhsulun ümumi stokunu paylaşır.'),canManageCosts);
}
const settingsData={branch:{id:'branch',name:'Store',address:'Bakı',phone:'',currency:'AZN',timezone:'Asia/Baku'},branches:[{id:'branch',name:'Store',address:'Bakı'}],users:[],rules:null,warehouses:[],registers:[]};
for(const tab of ['branch','users']){
 const {default:Settings}=await load('app/admin/web-settings.tsx',{react:fakeReact({0:settingsData,1:tab}),'@/lib/language':language,'./staff-access-settings':Dummy}),tree=Settings();
 assert.doesNotMatch(text(tree),/Satış qaydaları|Kassa və anbarlar|Kassa və anbar$/);assert.ok(nodes(tree).some(node=>node.type==='button'&&text(node)==='İstifadəçilər və rollar'));assert.equal(nodes(tree).some(node=>node.type===Dummy),tab==='users');
}
const {localStockUiTranslations}=await load('lib/local-stock-ui-translations.ts');
const keys=new Set();for(const row of localStockUiTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));assert.equal(keys.has(row[0]),false);keys.add(row[0]);}
const languageSource=await readFile('lib/language.tsx','utf8');assert.match(languageSource,/\.\.\.localStockUiTranslations/);
postcss.parse(await readFile('app/admin/web-workspace.css','utf8'));
console.log('PASS: web-vs-local staff navigation/loading/render boundaries, online-role redirects, harmless cashier/warehouse welcome, zero-free workspace and admin-only links, explicit cost/barcode/stock-free catalogue payloads with full public editing and colour photos, default-compatible local costs, and stock-free web company/user settings. No live data or desktop writes.');
