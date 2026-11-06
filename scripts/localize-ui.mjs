import fs from 'node:fs';
import ts from 'typescript';
const keys=new Set([...fs.readFileSync('lib/language.tsx','utf8').matchAll(/^ \["([^"]+)"/gm)].map(m=>JSON.parse('"'+m[1]+'"')));
const desktopRows=fs.readFileSync('lib/desktop-translations.ts','utf8').split('`')[1].trim().split('\n');
for(const row of desktopRows)keys.add(row.split('|')[0]);
for(const key of [...keys])keys.add(key.toLocaleUpperCase('az'));
const paths=['app/storefront.tsx','app/product-view.tsx','app/cart-sheet.tsx','app/hero-slider.tsx','app/commerce-ui.tsx','app/admin/page.tsx','app/admin/online/page.tsx','app/admin/thermal-receipt.tsx','app/admin/store/page.tsx','app/admin/store/commerce-manager.tsx'];
const patches=[];
for(const file of paths){
 const source=fs.readFileSync(file,'utf8');
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];
 const add=(start,end,text)=>edits.push({start,end,text});
 function expression(node){
  if(ts.isStringLiteral(node)&&keys.has(node.text))add(node.getStart(tree),node.end,`t(${JSON.stringify(node.text)})`);
  else if(ts.isConditionalExpression(node)){expression(node.whenTrue);expression(node.whenFalse);}
  else if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)){expression(node.left);expression(node.right);}
 }
 function visit(node){
  if(ts.isFunctionDeclaration(node)&&node.name&&/^[A-Z]/.test(node.name.text)&&node.body&&!source.slice(node.body.getStart(tree)+1,node.body.getStart(tree)+30).includes('useLanguage();'))add(node.body.getStart(tree)+1,node.body.getStart(tree)+1,'useLanguage();');
  if(ts.isJsxText(node)){const text=node.text.trim();if(keys.has(text))add(node.pos,node.end,`{t(${JSON.stringify(text)})}`);}
  if(ts.isJsxExpression(node)&&node.expression&&(!ts.isJsxAttribute(node.parent)||['placeholder','aria-label','title'].includes(node.parent.name.getText(tree))))expression(node.expression);
  if(ts.isJsxAttribute(node)&&['placeholder','aria-label','title'].includes(node.name.getText(tree))&&node.initializer&&ts.isStringLiteral(node.initializer)&&keys.has(node.initializer.text))add(node.initializer.getStart(tree),node.initializer.end,`{t(${JSON.stringify(node.initializer.text)})}`);
  ts.forEachChild(node,visit);
 }
 visit(tree);let result=source;for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
 if(!source.includes('from "@/lib/language"'))result=source.includes('"use client";')?result.replace('"use client";','"use client";\nimport {t,useLanguage} from "@/lib/language";'):'"use client";\nimport {t,useLanguage} from "@/lib/language";\n'+result;
 result=result.replaceAll('{label}</','{t(label)}</');
 for(const variable of ['message','error','notice','dashboardError'])result=result.replaceAll('{'+variable+'}', '{t('+variable+')}');
 if(process.argv.includes('--write'))fs.writeFileSync(file,result);
 patches.push('*** Begin Patch\n*** Update File: '+file+'\n@@\n-'+source.trimEnd().split('\n').join('\n-')+'\n+'+result.trimEnd().split('\n').join('\n+')+'\n*** End Patch');
}
if(!process.argv.includes('--write'))process.stdout.write(JSON.stringify(patches));
