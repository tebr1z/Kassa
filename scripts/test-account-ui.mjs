import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';
import ts from 'typescript';

const files=['app/account/page.tsx','app/account/order-list.tsx','app/account-settings.tsx','app/support-desk.tsx'];
const source=Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(file,'utf8')])));
for(const [file,code] of Object.entries(source)){
 const result=ts.transpileModule(code,{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
 assert.deepEqual((result.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error),[],file+' must remain valid TSX');
 assert.doesNotMatch(code,/localStorage|sessionStorage|clearCheckoutAttempt|saveCheckoutAttempt/,'Account UI must not mutate cart or pending-checkout persistence');
}
const account=source['app/account/page.tsx'];
assert.match(account,/identity\.current!==\(d\.user\?\.id\|\|null\)/);
assert.match(account,/setOrders\(\[\]\);setStats\(\{total:0,active:0,completed:0\}\)/);
assert.match(account,/<SupportDesk key=\{user\.id\}/);assert.match(account,/<AccountSettings key=\{user\.id\}/);
assert.match(account,/if\(authPending\.current\)return/);assert.match(account,/json\.ok!==true/);
assert.match(account,/aria-label=\{t\("Mağazaya qayıt"\)\}/,'Icon-only mobile back link must keep its accessible name');
const profile=source['app/account-settings.tsx'];
assert.match(profile,/run!==reverseRun\.current/);assert.match(profile,/run!==searchRun\.current/);
assert.match(profile,/newPassword&&!currentPassword/);assert.match(profile,/input\.value=''/);
assert.match(profile,/setAddress\(event\.target\.value\);setPin\(null\)/,'Manual address changes must clear stale coordinates');
assert.match(profile,/if\(savePending\.current\|\|searching\|\|locating\)return/);
const orders=source['app/account/order-list.tsx'];
assert.match(orders,/delivery_fee\?:/);assert.match(orders,/languageAmount\(Number\(order\.total\)\)/);
assert.doesNotMatch(orders,/order\.total\s*\+\s*fee|Number\(order\.total\)\s*\+\s*fee/,'Delivery fee is already included in order.total');
assert.match(orders,/navigator\.clipboard\.writeText\(order\.order_no\)/);
assert.match(source['app/support-desk.tsx'],/if\(sending\.current\)return/);
const css=await readFile('app/account/account.css','utf8');postcss.parse(css);
assert.match(css,/prefers-reduced-motion/);assert.match(css,/focus-visible/);assert.match(css,/minmax\(0,1fr\)/);
console.log('PASS: account TSX, privacy resets, safe auth guards, checkout-persistence isolation, profile/map race guards, password clearing, included delivery fee and responsive CSS.');
