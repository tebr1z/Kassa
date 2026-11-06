import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile('lib/language-options.ts','utf8');
const module=ts.transpile(source,{module:ts.ModuleKind.ESNext});
const {languageOptions,languageMenuCopy,isLanguage}=await import('data:text/javascript;base64,'+Buffer.from(module).toString('base64'));
assert.deepEqual(Object.keys(languageOptions),['az','en','ru','tr','zh']);
for(const [key,option] of Object.entries(languageOptions)){
 assert.equal(isLanguage(key),true);assert.ok(option.name&&option.description&&option.code);
 assert.ok(Object.values(languageMenuCopy[key]).every(value=>typeof value==='string'&&value.length>0));
}
for(const value of [null,undefined,{},'',false,'de','constructor','__proto__'])assert.equal(isLanguage(value),false);
const control=await readFile('lib/language.tsx','utf8'),css=await readFile('app/language-switcher.css','utf8');
const switcher=control.slice(control.indexOf('export function LanguageSwitcher()'),control.indexOf('export function LanguageProvider('));
assert.match(switcher,/<DropdownMenu modal=\{false\}>/);assert.match(switcher,/<DropdownMenuRadioGroup/);assert.match(switcher,/onValueChange=\{selectLanguage\}/);
assert.match(switcher,/aria-label=/);assert.match(switcher,/lang=\{code\}/);assert.doesNotMatch(switcher,/<select/);
assert.match(switcher,/if\(!isLanguage\(next\)\)return/);assert.match(switcher,/localStorage\.setItem\('birkassa-language',next\)/);
assert.match(control,/document\.documentElement\.lang=language/);assert.match(control,/window\.birkassaDesktop\?\.setLanguage\(language\)/);assert.match(control,/addEventListener\("storage"/);
assert.match(css,/focus-visible/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/max-width:calc\(100vw - 24px\)/);
console.log('PASS: five-language menu metadata, safe language validation, selected radio menu, persistence, cross-tab/desktop synchronization and responsive focus styles.');
