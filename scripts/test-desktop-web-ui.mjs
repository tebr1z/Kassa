import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import postcss from 'postcss';

// Real role policy, filtering and rendered component snapshots. All records are
// disposable fixtures; no network, desktop profile or business database is used.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const compiled=ts.transpileModule(await readFile(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error),[],path);
 const loaded={exports:{}};new Function('require','module','exports',compiled.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);return loaded.exports;
}
const roles=await load('lib/staff-access.ts'),mode=await load('lib/staff-workspace-mode.ts'),ui=await load('lib/desktop-web-ui.ts'),labels=await load('lib/desktop-web-labels.ts');
const labelKeys=[...(await readFile('lib/desktop-web-labels.ts','utf8')).matchAll(/^\s+([a-zA-Z]\w*):\[/gm)].map(match=>match[1]);
assert.ok(labelKeys.length>60);
for(const language of ['az','en','ru','tr','zh'])for(const key of labelKeys)assert.ok(typeof labels.desktopWebLabel(language,key)==='string'&&labels.desktopWebLabel(language,key).trim(),language+' has '+key);
for(const role of roles.staffRoles){
 const auth={local:true,user:{permissions:roles.staffPermissions(role)}};
 assert.equal(mode.canOpenWorkspaceSection(auth,'Veb sifarişləri'),['admin','manager','cashier'].includes(role));
 assert.equal(mode.canOpenWorkspaceSection(auth,'Veb dəstək'),['admin','manager'].includes(role));
 for(const local of [false,undefined])for(const section of ['Veb sifarişləri','Veb dəstək'])assert.equal(mode.canOpenWorkspaceSection({...auth,local},section),false);
 assert.equal(roles.canUseStaffApi(role,'/api/desktop-web-support','GET'),['admin','manager'].includes(role));
 for(const method of ['POST','PATCH','DELETE'])assert.equal(roles.canUseStaffApi(role,'/api/desktop-web-support',method),role==='admin');
 for(const method of ['GET','HEAD','POST'])assert.equal(roles.canUseStaffApi(role,'/api/desktop-inbox',method),['admin','manager','cashier'].includes(role));
 assert.equal(roles.canUseStaffApi(role,'/api/desktop-link','GET'),['admin','manager','cashier'].includes(role));
 for(const method of ['POST','DELETE','PATCH'])assert.equal(roles.canUseStaffApi(role,'/api/desktop-link',method),role==='admin');
}
assert.equal(roles.canUseStaffApi('cashier','/api/orders','GET'),false);
assert.equal(roles.canUseStaffApi('cashier','/api/orders','POST'),false);
assert.equal(roles.canUseStaffApi('cashier','/api/settings','GET'),false);
assert.equal(roles.canUseStaffApi('manager','/api/store-admin/chat','GET'),false);

const order={id:'remote-id',order_no:'WEB-TEST-42',status:'pending',fulfillment:'delivery',delivery_address:'Bakı, test ünvanı',delivery_stage:'received',total:21,coupon_discount:1,delivery_fee:2,full_name:'Fixture customer',phone:'050 123 45 67',created_at:'2026-11-15T12:00:00Z',updated_at:'2026-11-15T12:00:00Z',note:null,items:[{sku:'TEST-40',name:'Fixture product',option_snapshot:'40 · Qırmızı',quantity:2,unit_price:10,line_total:20}]};
const base={id:'inbox-id',payload:order,store_url:'https://example.invalid',local_order_id:null,local_status:null,local_stage:null,import_error:null,sync_conflict:null};
const imported={...base,id:'imported',local_order_id:'local-id',local_status:'pending',local_order:{id:'local-id',order_no:'WEB-local',customer_name:order.full_name,total:21,deliveryFee:2,couponDiscount:1,source:'catalog',items:[{productId:'local-product',optionId:'local-option',quantity:2,unitPrice:10}]}};
const failed={...base,id:'failed',import_error:'SKU TEST-40 not matched'};
const conflict={...imported,id:'conflict',sync_conflict:'remote_customer_changed'};
const cancelled={...base,id:'cancelled',payload:{...order,status:'cancelled',cancellation_reason:'Fixture cancellation reason'}};
const completed={...imported,id:'completed',local_status:'completed'};
const paid={...imported,id:'paid',local_paid:true};
const invalid={...imported,id:'invalid',invalid_payload:true};
assert.equal(ui.inboxIsUnpaid(imported),true,'Autoimported orders still need payment and must stay in the badge');
for(const row of [cancelled,completed,paid,invalid])assert.equal(ui.inboxIsUnpaid(row),false);
assert.equal(ui.inboxNeedsAttention(invalid),true);
assert.equal(ui.inboxNeedsAttention(failed),true);assert.equal(ui.inboxNeedsAttention(conflict),true);
assert.equal(ui.inboxMatchesFilter(imported,'new'),false);assert.equal(ui.inboxMatchesFilter(imported,'active'),true);
assert.equal(ui.inboxMatchesFilter(cancelled,'cancelled'),true);assert.equal(ui.inboxMatchesFilter(completed,'completed'),true);
assert.equal(ui.inboxMatchesFilter(conflict,'unresolved'),true);assert.equal(ui.inboxMatchesFilter(failed,'unresolved'),true);
const fixtures=[base,imported,failed,conflict,cancelled,completed];
assert.equal(fixtures.filter(ui.inboxIsUnpaid).length,4);
const dummy=()=>null;
const react=(states={})=>{let cursor=0;return {useState(initial){const index=cursor++;return [Object.hasOwn(states,index)?states[index]:typeof initial==='function'?initial():initial,()=>{}];},useRef:value=>({current:value}),useCallback:fn=>fn,useEffect(){}};};
function nodes(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
function text(node){return node==null||node===false?'':typeof node==='string'||typeof node==='number'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');}
for(const language of ['az','en','ru','tr','zh']){
 const copy=key=>labels.desktopWebLabel(language,key),languageMock={useLanguage:()=>language,t:value=>value,languageLocale:()=>({az:'az-AZ',en:'en-US',ru:'ru-RU',tr:'tr-TR',zh:'zh-CN'}[language])};
 const mocks={'@/lib/language':languageMock,'@/lib/desktop-web-labels':labels,'@/lib/desktop-web-ui':ui,'@/components/ui/button':{Button:dummy},'@/components/ui/input':{Input:dummy},'./desktop.css':{}};
 const {DesktopInbox}=await load('app/admin/desktop-panel.tsx',{...mocks,react:react({0:fixtures,1:'all',4:false,5:true,6:{configured:true,ordersLastSync:order.updated_at},7:true})});
 let selected=null;const tree=DesktopInbox({onOpenAtPos:value=>{selected=value;}}),all=nodes(tree),content=text(tree);
 assert.match(content,/Fixture cancellation reason/);assert.match(content,/SKU TEST-40 not matched/);
 for(const key of ['automatic','awaitingPayment','limited','conflict','cancelReason','openPos'])assert.ok(content.includes(copy(key)),language+' '+key);
 const buttons=all.filter(node=>node.type===dummy&&text(node)===copy('openPos'));
 assert.equal(buttons.length,2,'Ready imported and conflict order show POS availability, completed does not');
 assert.equal(buttons.filter(node=>node.props.disabled).length,1,'Conflicted order cannot be paid before review');
 buttons.find(node=>!node.props.disabled).props.onClick();assert.deepEqual(selected,imported.local_order,'Exact server-supplied order IDs, variant IDs and web prices go into existing POS loader');
 const supportData={tickets:[{id:'ticket-id',ticketNo:'RM-0042',subject:'Fixture support',kind:'order',status:'open',name:'Fixture client',email:'fixture@example.invalid',phone:'050 123 45 67',unread:true,unanswered:true,updatedAt:order.updated_at,lastBody:'Fixture message'}],attention:{total:1,unread:1,unanswered:1},configured:true,lastSync:order.updated_at,lastError:null};
 const {DesktopSupportPanel}=await load('app/admin/desktop-support-panel.tsx',{...mocks,react:react({0:supportData,2:false,3:'ticket-id',4:supportData.tickets[0],5:[{id:'message',sender:'customer',body:'<img onerror="unsafe"> customer message',createdAt:order.created_at,editedAt:null}]}),'lucide-react':{MessageSquare:dummy,Search:dummy,X:dummy}});
 const supportTree=DesktopSupportPanel(),supportNodes=nodes(supportTree),supportText=text(supportTree);
 for(const key of ['supportHelp','supportReply','unread','unanswered'])assert.ok(supportText.includes(copy(key)),language+' support '+key);
 assert.ok(supportText.includes('<img onerror="unsafe"> customer message'),'Customer text remains React text, never parsed HTML');
 assert.equal(supportNodes.some(node=>Object.hasOwn(node.props||{},'dangerouslySetInnerHTML')),false);
 assert.equal(supportNodes.some(node=>node.type==='textarea'||node.type==='form'),false,'Support mirror cannot send replies or edits');
 assert.equal(supportNodes.some(node=>node.type==='a'),false,'No external navigation escape from the local Electron workspace');
 for(const filter of ui.desktopInboxFilters)assert.ok(copy(filter));
}
const source=await readFile('app/admin/staff-dashboard.tsx','utf8');
assert.match(source,/auth\.local===true&&\['admin','manager','cashier'\]\.includes\(auth\.user\.role\)&&<DesktopStatus/);
assert.match(source,/active==='Veb dəstək'&&\['admin','manager'\]\.includes\(auth\.user\.role\)&&<DesktopSupportPanel/);
assert.match(source,/if\(Object\.keys\(cart\)\.length\|\|posOrder\|\|resumingWebOrder.current\)/,'Opening web orders does not silently replace the cashier current receipt');
assert.doesNotMatch(source,/onOrderLoaded=\{\(\)=>setPosOrder\(null\)\}/,'The linked order and exact web prices survive switching POS sections');
assert.match(source,/setBuyerName\(incomingOrder.customer_name\|\|""\)/,'The web customer snapshot is displayed on the receipt');
assert.match(source,/expectedTotal:salesOrderId\?total:undefined/,'Payment must compare the shown amount with the latest server order total');
const ast=ts.createSourceFile('staff-dashboard.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),pos=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='PosView');
const orderEffect=pos.body.statements.find(node=>ts.isExpressionStatement(node)&&node.getText(ast).startsWith('useEffect(')&&node.getText(ast).includes('if(!incomingOrder)return;'));
assert.ok(orderEffect,'Execute the real POS linked-order initialization');
const effectCode=ts.transpileModule(orderEffect.getText(ast),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
for(let remount=0;remount<2;remount++){
 const observed={};const args=['useEffect','incomingOrder','restore','setLockedOrder','setDiscount','setCustomerId','setBuyerName','setSalesOrderId','setOrderNo','setMessage','onOrderLoaded'];
 const setters=['cart','locked','discount','customer','buyer','salesOrder','orderNo','message'].map(key=>value=>{observed[key]=value;});
 new Function(...args,effectCode)(callback=>callback(),imported.local_order,...setters,()=>{});
 assert.deepEqual(observed.cart,{'local-product:local-option':2});assert.equal(observed.salesOrder,'local-id');assert.equal(observed.locked.deliveryFee,2);assert.equal(observed.discount,1);assert.equal(observed.buyer,'Fixture customer');
}
assert.match(source,/auth\.local!==true&&active==='Dəstək biletləri'/,'Desktop never mounts generic local ticket store by accident');
const supportSource=await readFile('app/admin/desktop-support-panel.tsx','utf8');
assert.doesNotMatch(supportSource,/method\s*:\s*['"](?:POST|PATCH|DELETE|PUT)['"]/,'Support mirror only performs GET reads');
assert.doesNotMatch(supportSource,/\/api\/store-admin\/chat/);
postcss.parse(await readFile('app/admin/desktop.css','utf8'));
console.log('Desktop web operations UI: five languages, autoimport unpaid counts, scoped filters, safe POS resume, read-only support, role isolation and CSS PASS');
