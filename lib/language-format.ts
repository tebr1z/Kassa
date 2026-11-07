import type {Language} from './language-options';

export const localeForLanguage=(language:Language)=>({az:'az-AZ',en:'en-US',ru:'ru-RU',zh:'zh-CN',tr:'tr-TR'} as const)[language];
export const languageUpperCase=(value:string,language:Language)=>language==='az'||language==='tr'?value.replace(/i/g,'İ').replace(/ı/g,'I').toUpperCase():value.toUpperCase();

// Node and embedded Chromium do not necessarily ship the same ICU locale data.
// Money must produce identical text during SSR and the first browser render.
export function formatLanguageAmount(value:number,language:Language){
 if(!Number.isFinite(value))return '—';
 const [whole,fraction]=value.toFixed(2).split('.');
 const group=language==='az'?' ':language==='ru'?'\u00a0':language==='tr'?'.':',';
 const decimal=language==='en'||language==='zh'?'.':',';
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g,group)+decimal+fraction;
}
