import ts from 'typescript';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const keys=new Set();
for(const file of ['lib/language.tsx','lib/storefront-translations.ts','lib/desktop-translations.ts','lib/account-ui-translations.ts','lib/order-cancellation-translations.ts']){
 const source=await readFile(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function scan(node){if(ts.isArrayLiteralExpression(node)&&node.elements.length===5&&node.elements.every(ts.isStringLiteral))keys.add(node.elements[0].text.toLocaleUpperCase('az'));ts.forEachChild(node,scan);}scan(tree);
 if(file.includes('desktop-translations'))for(const line of source.split('\n'))if(line.split('|').length===4)keys.add(line.split('|')[0].toLocaleUpperCase('az'));
}
const used=new Set(['Qəbul edildi','Hazırlanır','Götürməyə hazır','Hazırdır','Yoldadır','Təhvil verildi','Çatdırıldı','Hamısı','Aktiv sifarişlər','Tamamlanan sifarişlər','Ləğv edilənlər','Problem','Təklif','Sifariş','Gözləyir','Cavab var','Bağlı']);
function literals(node){if(ts.isStringLiteral(node))used.add(node.text);else if(ts.isConditionalExpression(node)){literals(node.whenTrue);literals(node.whenFalse);}else ts.forEachChild(node,literals);}
for(const file of ['app/account/page.tsx','app/account/order-list.tsx','app/account-settings.tsx','app/support-desk.tsx']){
 const source=await readFile(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function scan(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='t')node.arguments.forEach(literals);ts.forEachChild(node,scan);}scan(tree);
}
assert.deepEqual([...used].filter(key=>!keys.has(key.toLocaleUpperCase('az'))),[],'All customer login and order-history labels need a five-language entry');
console.log('PASS: customer login, orders, profile/address and support translation coverage in AZ/RU/EN/TR/ZH.');
