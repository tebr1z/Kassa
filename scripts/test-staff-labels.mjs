import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const importSource=source=>import('data:text/javascript;base64,'+Buffer.from(compile(source)).toString('base64'));
const labels=await importSource(await readFile('lib/staff-labels.ts','utf8'));
const {staffLabelTranslations}=await importSource(await readFile('lib/staff-label-translations.ts','utf8'));
const translations=new Map(staffLabelTranslations.map(row=>[row[0],row]));
for(const row of staffLabelTranslations){assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));}

for(const name of ['Sistem Administratoru','Administrator','admin',' ADMIN ']){
  assert.equal(labels.staffDisplayName(name,'admin'),'Baş rəhbər');
  assert.equal(labels.staffDisplayName(name,'admin',key=>translations.get(key)[2]),'Head administrator');
  assert.equal(labels.staffDisplayName(name,'cashier',()=>{throw Error('A real name must not be translated');}),name);
}
for(const role of ['admin','manager','cashier','warehouse','accountant','online_manager','online_assistant']){
  assert.equal(labels.staffDisplayName('Aygün Əliyeva',role,()=>{throw Error('A real name must not be translated');}),'Aygün Əliyeva');
  assert.ok(translations.has(labels.staffRoleLabel(role)),role+' has a five-language display label');
}
assert.equal(labels.staffRoleLabel('admin'),'Rəhbər');
assert.equal(labels.staffRoleLabel('unknown'),'İşçi');
assert.equal(labels.staffSectionLabel('İdarə paneli'),'İdarəetmə mərkəzi');
assert.equal(labels.staffSectionLabel('Maliyyə'),'Maliyyə');
for(const role of ['admin','manager','cashier','warehouse','accountant','online_manager','online_assistant'])assert.ok(labels.canAssignStaffPassword(role));
assert.ok(!labels.canAssignStaffPassword('customer'));

// Root may move the client component behind the unlisted server route. Test the
// actual dashboard implementation in either layout, not a duplicated fixture.
let dashboardPath='app/admin/staff-dashboard.tsx';
try{await access(dashboardPath);}catch{dashboardPath='app/admin/staff-dashboard.tsx';}
const source=await readFile(dashboardPath,'utf8');
const ast=ts.createSourceFile(dashboardPath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const home=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Home');
assert.ok(home?.body);
const initialLoad=home.body.statements.find(node=>ts.isExpressionStatement(node)&&node.getText(ast).startsWith('useEffect(')&&node.getText(ast).includes('void loadProducts()'));
assert.ok(initialLoad,'Initial data loading effect is present');
const runEffect=new Function('auth','useEffect','loadProducts','loadDashboard','staffPortalPath','window',compile(initialLoad.getText(ast)));
for(const [role,expected] of Object.entries({admin:['products','dashboard'],manager:['products','dashboard'],cashier:['products','dashboard'],warehouse:['products'],accountant:[],online_manager:['online'],online_assistant:['online']})){
  const calls=[];
  runEffect({authenticated:true,local:true,user:{id:'test',role}},fn=>fn(),()=>calls.push('products'),()=>calls.push('dashboard'),section=>'portal'+section,{location:{replace:path=>{assert.equal(path,'portal/online');calls.push('online');}}});
  assert.deepEqual(calls,expected,role+' only requests authorized initial datasets');
}
assert.ok(source.includes('["İdarə paneli", LayoutDashboard]'),'Permission key remains unchanged');
assert.ok(source.includes('t(staffSectionLabel(active))'));
assert.ok(source.includes('if(auth.user.role.startsWith("online_"))return <div className="auth-loading">'),'Online roles never mount the operational dashboard or POS before redirect');
assert.ok(source.includes('{canReadProductData&&<div className={"db-state "+dataStatus}>'),'Database badge only appears for roles that actually load product data');
assert.ok(!source.includes("?dataStatus:'live'"),'Roles without product queries are not labelled as live');
assert.ok(!/href=["']\/admin(?:\/|["'])|location\.replace\(["']\/admin/.test(source),'UI navigation uses the shared hidden portal helper');
assert.ok(source.includes('.filter(([id])=>role==="admin"||id==="audit")'),'Only administrator sees system/backup tabs');
assert.ok(source.includes('<InventoryView canDelete={auth.user.role==="admin"}'),'Only administrator receives inventory deletion permission');
assert.ok(source.includes('{canDelete&&<ProductDeleteDialog'),'Non-administrators never mount the deletion dialog');
assert.ok(source.includes('{canDelete&&<Button type="button" variant="destructive"'),'Non-administrators do not see the delete action');
const inventory=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='InventoryView');
const deactivate=inventory?.body?.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='deactivate');
const deactivateGuard=deactivate?.body?.statements[0];
assert.ok(deactivateGuard&&ts.isIfStatement(deactivateGuard)&&ts.isReturnStatement(deactivateGuard.thenStatement),'Deactivation starts with a permission/busy guard before any mutation');
const blocksDeactivation=new Function('canDelete','editing','variantUploadPending','saving','return '+deactivateGuard.expression.getText(ast));
assert.equal(blocksDeactivation(false,{id:'test'},{current:false},false),true,'Deactivation still refuses a non-administrator');
assert.equal(blocksDeactivation(true,null,{current:false},false),true,'Deactivation requires a current product');
assert.equal(blocksDeactivation(true,{id:'test'},{current:false},false),false,'Idle administrators retain the permitted action');
assert.equal(blocksDeactivation(true,{id:'test'},{current:true},false),true,'Photo upload prevents deactivation of its product');
assert.equal(blocksDeactivation(true,{id:'test'},{current:false},true),true,'A concurrent save prevents deactivation');
assert.ok(source.includes('<FinanceOverview canEditSalary={auth.user.role==="admin"}'),'Only administrator receives salary-edit permission');
const finance=await readFile('app/admin/finance-overview.tsx','utf8');
assert.ok(finance.includes('e.preventDefault();if(!canEditSalary)return;'),'Salary handler refuses writes without administrator permission');
assert.ok(finance.includes('data.employees.map(u=>canEditSalary?<form'),'Salary edit forms are administrator-only');
assert.ok(finance.includes('</form>:<div key={u.id} className="ops-assignment">'),'Other finance roles receive a read-only salary view, not a form');
assert.ok(!/DesktopConnection/.test(await readFile('app/admin/online/online-page.tsx','utf8')),'Online roles do not mount administrator-only desktop settings');
const locations=await readFile('app/admin/locations-panel.tsx','utf8');
const online=await readFile('app/admin/online/online-page.tsx','utf8');
assert.ok(online.includes("fetch('/api/auth',{method:'DELETE'})"),'Online-only staff have a real logout action');
assert.ok(online.includes('onClick={()=>void logout()}'),'Online-only staff can leave the shared portal');
assert.ok(locations.includes('u.is_active&&canAssignStaffPassword(u.role)'));
assert.ok(locations.includes('staffDisplayName(u.full_name,u.role,t)'));
assert.ok(locations.includes('t(staffRoleLabel(user.role))'));
assert.ok((await readFile('lib/language.tsx','utf8')).includes('...staffLabelTranslations'));
console.log('PASS: five-language staff names/roles, custom name preservation, stable permission keys, hidden portal links, actual role-aware loading effect, administrator-only system tabs and operational staff password selection.');
