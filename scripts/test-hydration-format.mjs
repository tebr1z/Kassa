import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url),reactUrl=pathToFileURL(require.resolve('react')).href,jsxUrl=pathToFileURL(require.resolve('react/jsx-runtime')).href;
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replaceAll('from "react/jsx-runtime"','from '+JSON.stringify(jsxUrl));
const formatUrl=moduleUrl(compile(await readFile('lib/language-format.ts','utf8'))),{formatLanguageAmount,languageUpperCase}=await import(formatUrl);
const commerce=await import(moduleUrl(compile(await readFile('lib/commerce.ts','utf8'))));
const expected={az:'1 234 567,80',en:'1,234,567.80',ru:'1\u00a0234\u00a0567,80',tr:'1.234.567,80',zh:'1,234,567.80'};
for(const [language,text] of Object.entries(expected)){assert.equal(formatLanguageAmount(1234567.8,language),text);assert.ok(formatLanguageAmount(-12.5,language).startsWith('-12'));}
assert.equal(formatLanguageAmount(NaN,'az'),'—');assert.equal(formatLanguageAmount(Infinity,'az'),'—');
const alphabet=['A','B','C','Ç','D','E','Ə','F','G','Ğ','H','X','I','İ','J','K','Q','L','M','N','O','Ö','P','R','S','Ş','T','U','Ü','V','Y','Z'];
assert.deepEqual([...alphabet].reverse().sort(commerce.compareCatalogNames),alphabet);
assert.equal(commerce.catalogTextLower('IŞIQ İÇKİ'),'ışıq içki');
assert.equal(languageUpperCase('işıq içki','az'),'İŞIQ İÇKİ');assert.equal(languageUpperCase('i ışık','tr'),'İ IŞIK');
const names=['Əsas qazan','Elek','Xəlbir','Işıq','İçki','Qazan','Kasa'];
const azSort=[...names].sort((a,b)=>a.localeCompare(b,'az')),fallbackSort=[...names].sort((a,b)=>a.localeCompare(b,'en'));
assert.notDeepEqual(azSort,fallbackSort,'A browser missing Azerbaijani ICU can really reorder the same SSR products');
const deterministic=[...names].sort(commerce.compareCatalogNames),originalCompare=String.prototype.localeCompare,originalLocale=Number.prototype.toLocaleString;
try{
 String.prototype.localeCompare=function(){throw Error('Unexpected browser ICU collation');};Number.prototype.toLocaleString=function(){throw Error('Unexpected browser ICU amount');};
 assert.deepEqual([...names].sort(commerce.compareCatalogNames),deterministic);for(const [language,text] of Object.entries(expected))assert.equal(formatLanguageAmount(1234567.8,language),text);
 const p=(id,name)=>({id,name,category:'Qablar',price:10,available:true});assert.deepEqual(commerce.relatedProducts(p('source','Məhsul'),names.map((name,index)=>p(String(index),name))).map(p=>p.name),deterministic.slice(0,4));
}finally{String.prototype.localeCompare=originalCompare;Number.prototype.toLocaleString=originalLocale;}

// Run the real provider, translator hooks and ProductPrice source with an
// external store already switched to Russian while the hydration snapshot is AZ.
// A tiny dictionary substitutes unrelated UI packages; the hook/function bodies
// below are extracted from the application, not rewritten test equivalents.
const languageSource=await readFile('lib/language.tsx','utf8'),ast=ts.createSourceFile('language.tsx',languageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const required=new Set(['t','languageLocale','languageAmount','useLanguage','useTranslations','LanguageProvider']);
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&required.has(node.name?.text)).map(node=>node.getText(ast));assert.equal(functions.length,required.size);
const state=languageSource.slice(languageSource.indexOf('const LanguageContext='),languageSource.indexOf('// Product names'));
const fixture=moduleUrl(compile(`import {createContext,useContext,useEffect,useSyncExternalStore,createElement} from ${JSON.stringify(reactUrl)};import {formatLanguageAmount,localeForLanguage,languageUpperCase} from ${JSON.stringify(formatUrl)};
${state}
const translations=new Map([
 ['Qiymət',['Qiymət','Цена','Price','Fiyat','价格']],['Endirimli qiymət',['Endirimli qiymət','Цена со скидкой','Sale price','İndirimli fiyat','优惠价']],['Əvvəlki qiymət',['Əvvəlki qiymət','Прежняя цена','Original price','Önceki fiyat','原价']],['Qənaət',['Qənaət','Экономия','You save','Kazancınız','节省']]
]);const upperTranslations=new Map(),desktopTranslations=[];const isLanguage=value=>['az','ru','en','tr','zh'].includes(value);function LanguageSwitcher(){return null;}
${functions.join('\n')}
export function setExternalLanguage(language){current=language;}
export function renderInLanguage(language,children){return createElement(LanguageContext.Provider,{value:language},children);}
export function UnsafeProbe(){const language=useLanguage();return createElement('span',{'data-language':language},t('Qiymət')+' '+languageAmount(1234.5));}
`));
const discountUrl=moduleUrl(compile(await readFile('lib/product-discount.ts','utf8')));
const language=await import(fixture),priceSource=(await readFile('app/product-price.tsx','utf8')).replace(/import ['"]\.\/product-price\.css['"];?/,'').replace("from '@/lib/language'",'from '+JSON.stringify(fixture)).replace("from '@/lib/product-discount'",'from '+JSON.stringify(discountUrl));
const {default:ProductPrice}=await import(moduleUrl(compile(priceSource)));
language.setExternalLanguage('ru');
const unsafe=renderToStaticMarkup(createElement(language.LanguageProvider,null,createElement(language.UnsafeProbe)));assert.ok(unsafe.includes('data-language="az"'));assert.ok(unsafe.includes('Цена'),'This reproduces why module-global t can disagree with the hydration snapshot');
const price=createElement(ProductPrice,{price:1234.5,originalPrice:1500});
const stable=renderToStaticMarkup(createElement(language.LanguageProvider,null,price));assert.ok(stable.includes('aria-label="Endirimli qiymət"'));assert.ok(stable.includes('1 234,50'));assert.ok(!stable.includes('Цена'),'Real price rendering obeys the React snapshot even when external state changed');
const russian=renderToStaticMarkup(language.renderInLanguage('ru',price));assert.ok(russian.includes('Цена со скидкой'));assert.ok(russian.includes('1\u00a0234,50'),'After hydration the same component follows the selected language');
const storefront=await readFile('app/storefront.tsx','utf8');assert.ok(!storefront.includes('.localeCompare('));for(const path of ['app/storefront.tsx','app/product-view.tsx','app/product-price.tsx','app/hero-slider.tsx','app/commerce-ui.tsx'])assert.ok((await readFile(path,'utf8')).includes('useTranslations'),'SSR text uses a context-bound translator: '+path);
console.log('PASS: proven AZ/fallback collation difference, deterministic catalogue ordering and five-language money without ICU, reproduced external-store/snapshot mismatch, real provider/ProductPrice snapshot-safe SSR and language updates.');
