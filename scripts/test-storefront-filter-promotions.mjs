import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';

// Execute the real storefront and its state handlers without effects, network,
// database access, customer data or credentials. Child components stay isolated.
const require=createRequire(import.meta.url);
async function load(file,mocks={}){
 const result=ts.transpileModule(await readFile(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((result.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error),[],file);
 const loaded={exports:{}};
 new Function('require','module','exports',result.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),loaded,loaded.exports);
 return loaded.exports;
}
const commerce=await load('lib/commerce.ts'),cart=await load('lib/storefront-cart.ts');
const child=()=>null,icons=new Proxy({},{get:()=>child});
async function harness(){
 const hooks=[];let cursor=0;
 const react={useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},useCallback:callback=>callback,useEffect(){},useRef:initial=>({current:initial})};
 const {default:Storefront}=await load('app/storefront.tsx',{
  react,'next/link':child,'lucide-react':icons,'@/lib/storefront-about-translations':await load('lib/storefront-about-translations.ts'),'@/lib/commerce':commerce,'@/lib/storefront-cart':cart,
  '@/lib/language':{useTranslations:()=>({t:value=>value,language:'az'}),languageAmount:value=>String(value),LanguageSwitcher:child},
  '@/lib/product-discount':await load('lib/product-discount.ts'),'@/lib/product-options':await load('lib/product-options.ts'),'@/lib/catalog-illustrations':await load('lib/catalog-illustrations.ts'),
  './product-price':child,'./storefront-presence':{AboutLocation:child,StoreSocialLinks:child},'./product-view':child,'./hero-slider':child,'./catalog-search':child,'./storefront-announcement':child,'./cart-sheet':child,'./brand-logo':{BrandLogo:child},'./commerce-ui':{ContactBox:child,WhatsAppButton:child},'./storefront-v2.css':{},
 });
 return props=>{cursor=0;return Storefront(props);};
}
function nodes(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
const section=(tree,id)=>nodes(tree).find(node=>node.props?.id===id);
const search=tree=>nodes(tree).find(node=>typeof node.props?.onQuery==='function');
const menu=(tree,label)=>nodes(tree).find(node=>node.props?.label===label);
function assertPromotions(tree,visible,label){
 for(const id of ['secilmis','endirim'])assert.equal(Boolean(section(tree,id)),visible,id+': '+label);
}
const item=(id,name,category,price=10,originalPrice=price)=>({id,name,category,price,originalPrice,code:'12345'+id,image:'',unit:'ədəd',available:true,options:[],description:'',specifications:''});
const initialCatalog={brand:{name:'Fixture',featuredProductId:'1'},products:[item('1','Manqal 40 sm','Manqallar',8,10),item('2','Manqal 50 sm','Manqallar'),item('3','Qazan 5 l','Qazanlar',12,15)],slides:[],categories:[{id:'grill',name:'Manqallar',image:''}]};

for(const catalogPage of [false,true]){
 const render=await harness(),props={initialCatalog,catalogPage};let tree=render(props);
 assertPromotions(tree,true,'Unfiltered home/catalog keeps promotions');
 menu(tree,'Kateqoriya').props.onToggle();tree=render(props);
 assertPromotions(tree,true,'Opening the filter menu alone is not filtering');
 search(tree).props.onQuery('  \t\n ');tree=render(props);
 assertPromotions(tree,true,'Whitespace-only search is treated as cleared');
 search(tree).props.onQuery('manqal');tree=render(props);
 assertPromotions(tree,false,'Nonblank search hides promotions');
 assert.equal(section(tree,'catalog-products').props.children.length,2,'Actual search results stay visible');
 search(tree).props.onQuery('');tree=render(props);
 assertPromotions(tree,true,'Clearing search restores promotions');
 menu(tree,'Kateqoriya').props.onChange('Manqallar');tree=render(props);
 assertPromotions(tree,false,'Category alone hides promotions');
 assert.equal(section(tree,'catalog-products').props.children.length,2);
 search(tree).props.onQuery('');tree=render(props);
 assertPromotions(tree,false,'Clearing search must not undo an active category');
 menu(tree,'Kateqoriya').props.onChange('Hamısı');tree=render(props);
 assertPromotions(tree,true,'All categories restores promotions');
 menu(tree,'Model').props.onChange('Manqal');tree=render(props);
 assertPromotions(tree,false,'Model alone hides promotions');
 menu(tree,'Kateqoriya').props.onChange('Hamısı');tree=render(props);
 assertPromotions(tree,false,'An applicable model remains active when all categories is chosen');
 menu(tree,'Kateqoriya').props.onChange('Qazanlar');tree=render(props);
 assert.equal(menu(tree,'Model').props.value,'Hamısı','Changing category clears incompatible models');
 assertPromotions(tree,false,'Active category still hides promotions after model reset');
 menu(tree,'Kateqoriya').props.onChange('Hamısı');tree=render(props);
 assertPromotions(tree,true,'Clearing the last filter restores promotions');
 nodes(tree).find(node=>node.type==='select').props.onChange({target:{value:'sale'}});tree=render(props);
 assertPromotions(tree,true,'Sorting alone keeps promotions');
 menu(tree,'Kateqoriya').props.onChange('Manqallar');menu(tree,'Model').props.onChange('Manqal');search(tree).props.onQuery('zzzzzzzzzz');tree=render(props);
 assertPromotions(tree,false,'Empty results never reintroduce unrelated promotional products');
 const reset=nodes(tree).find(node=>node.type==='button'&&node.props?.children==='Bütün məhsullar');assert.ok(reset);
 reset.props.onClick();tree=render(props);
 assert.equal(search(tree).props.query,'');assert.equal(menu(tree,'Kateqoriya').props.value,'Hamısı');assert.equal(menu(tree,'Model').props.value,'Hamısı');
 assertPromotions(tree,true,'The existing full reset restores both promotion sections');
}
for(const props of [{categoryId:'grill'},{categoryId:'missing'},{productId:'1'},{productId:'missing'},{picksPage:true}]){
 const render=await harness(),tree=render({initialCatalog,...props});
 assertPromotions(tree,false,'Detail, dedicated category and picks pages do not mount homepage promotions: '+JSON.stringify(props));
 if(props.picksPage)assert.ok(nodes(tree).some(node=>node.type==='h1'&&node.props?.children==='Sizin üçün seçdik'),'Dedicated recommendations page remains available');
}
console.log('PASS: real storefront search/category/model handlers hide both promotional sections, whitespace and cleared/reset states restore them, sorting is preserved, result products remain visible, and dedicated category/product/picks pages stay isolated. No effects, network or database used.');
