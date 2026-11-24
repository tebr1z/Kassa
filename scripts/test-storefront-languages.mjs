import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {cloneElement,createElement,isValidElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Real customer components, dictionary rows and search helpers, with isolated
// hook state. Effects never run and fetch is forbidden. No API, browser storage,
// customer submission, database or merchant catalogue is read or modified.
const nativeRequire=createRequire(import.meta.url),cache=new Map();
let languageCode='az',currentHooks=null,cursor=0,networkCalls=0;
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');
Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:()=>{networkCalls++;throw new Error('Network is forbidden in the language fixture');}});

const passthrough=({children})=>children??null,empty=()=>null;
const react={
 createContext:initial=>({initial,Provider:passthrough}),
 useContext:()=>languageCode,
 useEffect(){},useLayoutEffect(){},
 useCallback:callback=>callback,
 useMemo:callback=>callback(),
 useSyncExternalStore:(_subscribe,_snapshot,serverSnapshot)=>serverSnapshot(),
 useState(initial){
  assert.ok(currentHooks,'Component hooks must run in an isolated fixture');
  const slots=currentHooks,index=cursor++;
  if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;
  return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];
 },
 useRef(initial){
  assert.ok(currentHooks);const index=cursor++;
  if(!(index in currentHooks))currentHooks[index]={current:initial};
  return currentHooks[index];
 },
 useId(){assert.ok(currentHooks);return 'language-fixture-'+cursor++;},
};
function instance(Component){
 const slots=[];
 return {
  render(props={}){
   const previous=currentHooks,previousCursor=cursor;currentHooks=slots;cursor=0;
   try{return Component(props);}finally{currentHooks=previous;cursor=previousCursor;}
  },
  // Inject a display state only; never call a submit handler to obtain it.
  state(index,value){assert.ok(index in slots);slots[index]=value;},
 };
}
function resolveFile(file){
 for(const candidate of [file,file+'.ts',file+'.tsx',file+'.js',path.join(file,'index.ts'),path.join(file,'index.tsx')])if(existsSync(candidate))return path.resolve(candidate);
 throw new Error('Fixture dependency not found: '+file);
}
function load(file){
 file=resolveFile(file);if(file.endsWith('.css'))return {};
 if(cache.has(file))return cache.get(file).exports;
 if(file===path.resolve('app/cart-sheet.tsx'))return {__esModule:true,default:empty};
 const record={exports:{}};cache.set(file,record);
 const compiled=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((compiled.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error),[],file);
 new Function('require','module','exports',compiled.outputText)(name=>{
  if(name==='react')return react;
  if(name==='lucide-react')return new Proxy({},{get:()=>empty});
  if(name==='next/link')return {__esModule:true,default:({children,...props})=>createElement('a',props,children)};
  if(name==='next/image')return {__esModule:true,default:props=>createElement('img',Object.fromEntries(Object.entries(props).filter(([key])=>!['priority','fill','unoptimized'].includes(key))))};
  if(name==='next/navigation')return {useRouter:()=>({push(){}}),useSearchParams:()=>new URLSearchParams()};
  if(name==='@/components/ui/dropdown-menu')return new Proxy({},{get:()=>passthrough});
  if(name.startsWith('@/'))return load(path.resolve(name.slice(2)));
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));
  assert.ok(['react/jsx-runtime'].includes(name),'Unexpected external dependency: '+name);
  return nativeRequire(name);
 },record,record.exports);
 return record.exports;
}
function expand(node){
 // The expansion turns JSX's static sibling arrays into runtime arrays.
 // Give those fixture-created arrays stable keys without changing source JSX.
 if(Array.isArray(node))return node.map((child,index)=>{const resolved=expand(child);return isValidElement(resolved)&&resolved.key===null?cloneElement(resolved,{key:'fixture-'+index}):resolved;});
 if(!isValidElement(node))return node;
 if(typeof node.type==='function')return expand(instance(node.type).render(node.props));
 return cloneElement(node,{},expand(node.props.children));
}
function nodes(node){return Array.isArray(node)?node.flatMap(nodes):!isValidElement(node)?[]:[node,...nodes(node.props.children)];}
function text(node){return Array.isArray(node)?node.map(text).join(''):isValidElement(node)?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';}
const find=(tree,predicate)=>nodes(tree).find(predicate);
const section=(tree,id)=>find(tree,node=>node.props.id===id);
const categoryMenu=tree=>find(tree,node=>node.props.label==='Kateqoriya');
const catalogSearch=tree=>find(tree,node=>typeof node.props.onQuery==='function');
const productIds=tree=>section(tree,'catalog-products').props.children.map(node=>node.props.product.id);

try{
 const language=load('lib/language.tsx'),commerce=load('lib/commerce.ts');
 const {storefrontLanguageFixes}=load('lib/storefront-language-fixes.ts');
 const {checkoutTurkishOverrides}=load('lib/checkout-translations.ts');
 const {localizeStorefrontAbout}=load('lib/storefront-about-translations.ts');
 const {default:Storefront}=load('app/storefront.tsx'),{default:CatalogSearch}=load('app/catalog-search.tsx');
 const {default:HeroSlider}=load('app/hero-slider.tsx'),{default:ProductView}=load('app/product-view.tsx');
 const {ContactBox,CouponBox,WhatsAppButton}=load('app/commerce-ui.tsx');
 const aboutSource=ts.createSourceFile('about.ts',readFileSync('lib/storefront-about-translations.ts','utf8'),ts.ScriptTarget.Latest,true);
 let publishedAbout;
 function findPublished(node){if(ts.isVariableDeclaration(node)&&node.name.getText(aboutSource)==='publishedAboutAz')publishedAbout=node.initializer.text;ts.forEachChild(node,findPublished);}
 findPublished(aboutSource);assert.ok(publishedAbout);
 const codes=['az','ru','en','tr','zh'];
 const categoryRows=[
  ['Balta və bıçaqlar','Топоры и ножи','Axes and knives','Baltalar ve bıçaklar','斧头与刀具'],
  ['Çaydan və çayniklər','Чайники и заварники','Kettles and teapots','Çaydanlıklar ve demlikler','水壶与茶壶'],
  ['Manqallar','Мангалы','Charcoal grills','Mangallar','炭火烤炉'],
  ['Saclar','Саджи','Saj griddles','Saclar','萨吉烤盘'],
  ['Şirə çəkənlər','Соковыжималки','Juicers','Meyve sıkacakları','榨汁机'],
  ['Sürtgəclər','Тёрки','Graters','Rendeler','刨丝器'],
 ];
 assert.equal(new Set(storefrontLanguageFixes.map(row=>row[0])).size,storefrontLanguageFixes.length,'New rows must not repeat keys within their module');
 for(const row of storefrontLanguageFixes){
  assert.equal(row.length,5);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));
  assert.ok(language.translationKeys.includes(row[0]),'New dictionary module must be registered: '+row[0]);
  for(const [index,code] of codes.entries())assert.equal(language.t(row[0],code),code==='tr'&&checkoutTurkishOverrides[row[0]]?checkoutTurkishOverrides[row[0]]:row[index]);
 }
 const item=(id,name,category)=>({id,code:'68038'+id,name,category,price:8,originalPrice:10,image:'',unit:'ədəd',available:true,options:[],description:'',specifications:''});
 const products=[item('1','Satıcının manqalı 40 sm','Manqallar'),item('2','Satıcının manqalı 50 sm','Manqallar'),item('3','Satıcının sacı 60 sm','Saclar')];
 const address='Abşeron ticarət mərkəzi Abşeron mall sıra:1 korpus: 6 mağaza:4';
 const initialCatalog={brand:{name:'RestaMarket',kind:'store',featuredProductId:'1',description:'Gündəlik ehtiyaclarınız, bir ünvanda.',about:publishedAbout,address,phone:'+994 50 123 45 67',whatsapp:'994501234567'},products,slides:[],categories:[{id:'grill-fixture',name:'Manqallar',image:''},{id:'saj-fixture',name:'Saclar',image:''}]};
 const unknownCopy='Satıcının dəyişdirdiyi unikal mətn — 保留';
 const staticProductKeys=['Məhsul haqqında sualınız var? Əlaqə bölməsindən bizə yazın, seçim etməkdə kömək edək.','Miqdarı səbətdə dəyişə və sifarişi oradan tamamlaya bilərsiniz.','Sifariş hazır olduqda hesabınızda görünəcək.','Sifariş zamanı ünvanınızı qeyd edin.','Sifarişiniz nəzarətinizdə','Mərhələləri şəxsi hesabınızdan izləyin.','Daha yaxından tanıyın','Bu məhsula aid əlavə açıqlama hələ daxil edilməyib. Ətraflı məlumat üçün bizimlə əlaqə saxlaya bilərsiniz.','Seçiminizi tamamlayın','Bunlar da xoşunuza gələ bilər','Detalları görmək üçün siçanı şəkil üzərində hərəkət etdirin.','Böyütmək üçün toxunun, baxmaq üçün sürüşdürün.','Klaviatura: Enter ilə böyüdün, oxlarla hərəkət edin, Escape ilə kiçildin.'];

 for(const [index,code] of codes.entries()){
  languageCode=code;const t=value=>language.t(value,code);
  for(const row of categoryRows)assert.equal(t(row[0]),row[index]);
  assert.equal(localizeStorefrontAbout(unknownCopy,code),unknownCopy,'Custom merchant About content is never replaced');
  const translatedAbout=localizeStorefrontAbout(publishedAbout,code);
  assert.equal(translatedAbout===publishedAbout,code==='az','Known About copy must be translated in every other language');
  const windowsAbout=publishedAbout.replace(/\r?\n/g,'\r\n');
  assert.equal(localizeStorefrontAbout(windowsAbout,code),code==='az'?windowsAbout:translatedAbout,'Line-ending differences must not block approved copy translation');

  const store=instance(Storefront);let tree=store.render({initialCatalog}),expanded=expand(tree);
  const about=section(expanded,'about');assert.ok(text(about).includes(translatedAbout));
  assert.ok(text(about).includes(t(address)),'Exact approved address is localized');
  const iframe=find(about,node=>node.type==='iframe');assert.ok(iframe);assert.equal(new URL(iframe.props.src).searchParams.get('hl'),code==='zh'?'zh-CN':code);
  assert.equal(nodes(expanded).filter(node=>node.type==='iframe').length,1,'Map remains only in About');
  assert.ok(text(expanded).includes(products[0].name),'Merchant product names remain unchanged');
  assert.ok(text(expanded).includes(t('Manqallar')),'Home categories are localized');
  assert.ok(find(expanded,node=>node.type==='a'&&node.props.href==='/categories/grill-fixture'),'Category URLs retain their raw identifiers');
  assert.ok(renderToStaticMarkup(expanded).includes('<footer'),'Actual translated customer tree must render');
  const custom=expand(instance(Storefront).render({initialCatalog:{...initialCatalog,brand:{...initialCatalog.brand,about:unknownCopy}}}));
  assert.ok(text(section(custom,'about')).includes(unknownCopy));

  // Exercise real search/filter handlers, not only dictionary lookups.
  catalogSearch(tree).props.onQuery(t('Manqallar'));tree=store.render({initialCatalog});
  assert.deepEqual(productIds(tree),['1','2'],'Translated category search finds matching raw catalogue products: '+code);
  catalogSearch(tree).props.onQuery('');tree=store.render({initialCatalog});
  const menuNode=categoryMenu(tree),menu=instance(menuNode.type),menuProps={...menuNode.props,open:true};
  let menuTree=menu.render(menuProps);
  find(menuTree,node=>node.type==='input').props.onChange({target:{value:t('Manqallar')}});menuTree=menu.render(menuProps);
  const options=nodes(menuTree).filter(node=>node.props.role==='option');
  assert.equal(options.length,1,'Translated filter search narrows category labels: '+code);
  assert.equal(text(options[0]),t('Manqallar'));options[0].props.onClick();tree=store.render({initialCatalog});
  assert.equal(categoryMenu(tree).props.value,'Manqallar','Only the display is translated; stored filter value stays raw');
  assert.deepEqual(productIds(tree),['1','2']);
  assert.ok(commerce.productSearchScore(products[0],t('Manqallar'),t)>0);
  assert.equal(commerce.labelMatches('Manqallar',t('Manqallar'),t),true);

  const suggestion=instance(CatalogSearch),suggestionProps={products,query:t('Manqallar'),onQuery(){}};
  let suggestionTree=suggestion.render(suggestionProps);
  find(suggestionTree,node=>node.props.role==='combobox').props.onFocus();suggestionTree=suggestion.render(suggestionProps);
  const results=nodes(suggestionTree).filter(node=>node.props.role==='option');
  assert.equal(results.length,2,'Localized category search appears in quick suggestions');
  assert.equal(results[0].props.href,commerce.productPath(products[0]));
  assert.ok(text(results[0]).includes(products[0].name));assert.ok(text(results[0]).includes(t('Manqallar')));

  const slides=[{id:'fixture',badge:'Topdan və pərakəndə satış',heading:'Gündəlik ehtiyaclarınız, bir ünvanda.',description:'Topdan satisda 5% endirim olacaq.',productId:'1'}];
  const hero=expand(instance(HeroSlider).render({slides,products}));
  for(const key of [slides[0].badge,slides[0].heading,slides[0].description])assert.ok(text(hero).includes(t(key)),'Known hero copy is translated: '+code+' '+key);
  assert.ok(text(hero).includes(products[0].name));assert.ok(text(hero).includes(t('Manqallar')));
  const customHero=expand(instance(HeroSlider).render({slides:[{...slides[0],badge:'Merchant badge fixture',heading:unknownCopy,description:'Unchanged merchant description fixture'}],products}));
  for(const value of ['Merchant badge fixture',unknownCopy,'Unchanged merchant description fixture'])assert.ok(text(customHero).includes(value));

  const product={...products[0],specifications:'Satıcı qeydi: dəyişməyən-dəyər-123'};
  const detail=expand(instance(ProductView).render({product,products,inCart:2,onAdd(){},onOpenCart(){}})),detailText=text(detail);
  for(const key of staticProductKeys){assert.ok(detailText.includes(t(key)),'Product UI copy is translated: '+code+' '+key);if(['ru','en','zh'].includes(code))assert.ok(!detailText.includes(key),'Untranslated product UI leaked: '+key);}
  assert.ok(detailText.includes(product.name));assert.ok(detailText.includes('dəyişməyən-dəyər-123'));assert.ok(detailText.includes(t('Manqallar')));
  assert.equal(find(detail,node=>node.props.className==='pd-breadcrumb').props['aria-label'],t('Səhifə yolu'));
  assert.ok(detailText.includes(t('Şəkil əlavə edilməyib')));
  const photographed=expand(instance(ProductView).render({product:{...product,image:'/fixture-product.jpg',images:['/fixture-product.jpg','/fixture-extra.jpg']},products,inCart:0,onAdd(){},onOpenCart(){}}));
  assert.ok(find(photographed,node=>node.type==='button'&&node.props['aria-label']===product.name+' — '+t('Şəkli böyüt')));
  assert.ok(find(photographed,node=>node.type==='button'&&node.props['aria-label']===product.name+' — '+t('Məhsul şəkli')+' 1'));
  renderToStaticMarkup(detail);renderToStaticMarkup(photographed);

  const contact=instance(ContactBox);let contactTree=contact.render({whatsapp:initialCatalog.brand.whatsapp});
  assert.equal(find(contactTree,node=>node.type==='input'&&node.props.name==='name').props.placeholder,t('Adınız'));
  assert.equal(find(contactTree,node=>node.type==='textarea').props.placeholder,t('Məhsul, sifariş və ya təklifiniz barədə…'));
  contact.state(0,'Mesajınız qəbul olundu. Tezliklə sizinlə əlaqə saxlayacağıq.');contact.state(1,true);contactTree=contact.render({whatsapp:initialCatalog.brand.whatsapp});
  assert.equal(text(find(contactTree,node=>node.props.role==='status')),t('Mesajınız qəbul olundu. Tezliklə sizinlə əlaqə saxlayacağıq.'));
  assert.ok(text(contactTree).includes(t('Göndərilir…')));
  const whatsapp=expand(instance(WhatsAppButton).render({whatsapp:initialCatalog.brand.whatsapp}));
  assert.equal(new URL(find(whatsapp,node=>node.type==='a').props.href).searchParams.get('text'),t('Salam, dəstək lazımdır.'));
  const coupon=instance(CouponBox);coupon.render({items:[],onApply(){}});coupon.state(1,{text:'Kupon tətbiq edildi',discount:1.25});
  const couponTree=coupon.render({items:[],onApply(){}});
  assert.equal(text(find(couponTree,node=>node.props.role==='status')),t('Kupon tətbiq edildi')+': −'+language.languageAmount(1.25,code)+' AZN');
 }
 assert.equal(networkCalls,0);
 console.log('PASS: real AZ/RU/EN/TR/ZH storefront, known/custom About copy, localized category filters/search/suggestions with raw IDs, hero copy, product UI/gallery labels, contact display states, WhatsApp and coupon amounts; one localized About map. No network, storage, DB or submissions used.');
}finally{
 if(fetchDescriptor)Object.defineProperty(globalThis,'fetch',fetchDescriptor);else delete globalThis.fetch;
}

