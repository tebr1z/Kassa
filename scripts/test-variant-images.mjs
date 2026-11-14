import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Tests real source components without network, a database, image generation,
// or changing any existing merchant photos.
const require=createRequire(import.meta.url);
async function load(path,mocks={}){
 const compiled=ts.transpileModule(await readFile(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
 assert.deepEqual((compiled.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error),[],path);
 const result={exports:{}};new Function('require','module','exports',compiled.outputText)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),result,result.exports);return result.exports;
}
function nodes(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
const commerce=await load('lib/commerce.ts');
const variants=await load('lib/variant-selection.ts',{'./commerce':commerce});
const images=await load('lib/variant-images.ts');
const option=(id,color,size,image)=>({id,label:[size,color].join(' · '),size,color,kind:'',price:null,image,attributes:{}});
const product={id:'variant-photo-product',code:'123456',name:'Rəngli manqal',category:'Manqallar',unit:'ədəd',price:10,originalPrice:10,basePrice:10,baseOriginalPrice:10,image:'/media/main.jpg',images:['/media/main.jpg','/media/detail.jpg'],description:'Sınaq məhsulu',specifications:'',available:true,options:[option('red30','Qırmızı','30 sm','/media/red-30.jpg'),option('red40','Qırmızı','40 sm','/media/red-40.jpg'),option('green40','Yaşıl','40 sm','/media/green.jpg'),option('gray40','Boz','40 sm',undefined)]};
const base=commerce.productPath(product);
const query=value=>new URL(value.startsWith('/')?value:'/?'+value,'https://restamarket.az').searchParams;
const selection=value=>variants.variantSelection(product,query(value));
const red30Path=commerce.productVariantPath(product,product.options[0]);
assert.equal(images.variantPreviewImage(selection('')),'','No choice never previews an arbitrary color');
assert.equal(images.variantPreviewImage(selection('reng=qirmizi')),'/media/red-30.jpg','Color-only preview uses a photo from that color without choosing a size');
assert.equal(selection('reng=qirmizi').selectedOption,undefined);
assert.equal(images.variantPreviewImage(selection(red30Path)),'/media/red-30.jpg');
assert.equal(images.variantPreviewImage(selection(commerce.productVariantPath(product,product.options[1]))),'/media/red-40.jpg','Exact size+color photo takes precedence over the first photo for that color');
assert.equal(images.variantPreviewImage(selection('reng=yasil')),'/media/green.jpg');
assert.equal(selection('reng=yasil').selectedOption,undefined,'A single size is still not automatically selected');
assert.equal(images.variantPreviewImage(selection('reng=boz')),'');
assert.equal(images.variantPreviewImage(selection(commerce.productVariantPath(product,product.options[3]))),'','Exact option without an assigned photo falls back to the main gallery');
for(const invalid of ['reng=missing','reng=yasil&olcu=30-sm','reng=qirmizi&reng=yasil','variant=missing','olcu=30-sm'])assert.equal(images.variantPreviewImage(selection(invalid)),'','Invalid/size-only state never borrows another color photo: '+invalid);
const firstMissing={...product,options:[{...product.options[0],image:undefined},product.options[1],product.options[2]]};
assert.equal(images.variantPreviewImage(variants.variantSelection(firstMissing,query('reng=qirmizi'))),'/media/red-40.jpg','An empty first row does not hide another uploaded photo matching the chosen color');
assert.equal(images.productOptionImage(product,product.options[2]),'/media/green.jpg');
assert.equal(images.productOptionImage(product,product.options[3]),'/media/main.jpg');
assert.equal(images.productOptionImage({...product,image:'',images:['/media/detail.jpg']}),'/media/detail.jpg');
assert.deepEqual(images.productGalleryImages(product,'/media/red-30.jpg'),['/media/red-30.jpg','/media/main.jpg','/media/detail.jpg']);
assert.deepEqual(images.productGalleryImages(product,'/media/main.jpg'),['/media/main.jpg','/media/detail.jpg'],'Preferred photo is not duplicated');
assert.deepEqual(images.productGalleryImages({...product,image:'',images:[]}),[]);

const language={t:value=>value,useLanguage(){},languageAmount:value=>Number(value).toFixed(2),languageLocale:()=> 'az-AZ',useTranslations:()=>({t:value=>value,languageAmount:value=>Number(value).toFixed(2)})};
const icons=new Proxy({},{get:()=>()=>null});
const Link=({children,...props})=>createElement('a',props,children);
const Picker=()=>null;
let browserUrl='https://restamarket.az'+base;
const productMocks={
 'next/link':Link,'next/navigation':{useSearchParams:()=>new URL(browserUrl).searchParams},
 '@/lib/language':language,'@/lib/commerce':commerce,'@/lib/variant-selection':variants,'@/lib/variant-images':images,
 '@/lib/product-discount':await load('lib/product-discount.ts'),'lucide-react':icons,'./product-view.css':{},
 './product-price':()=>null,'./product-variant-picker':Picker,
};
const {default:View}=await load('app/product-view.tsx',productMocks);
const props={product,products:[],inCart:0,onAdd(){},onOpenCart(){}};
const renderAt=value=>{browserUrl=new URL(value,'https://restamarket.az').href;return renderToStaticMarkup(createElement(View,props));};
const mainSource=html=>html.match(/<img class="pd-main-image" src="([^"]+)"/)?.[1];
for(const [path,expected] of [[base,'/media/main.jpg'],[base+'?reng=qirmizi','/media/red-30.jpg'],[red30Path,'/media/red-30.jpg'],[base+'?reng=yasil','/media/green.jpg'],[base+'?reng=boz','/media/main.jpg'],[base+'?reng=yasil&olcu=30-sm','/media/main.jpg']]){
 const html=renderAt(path);assert.equal(mainSource(html),expected,'SSR initial photo matches the current exact/partial URL: '+path);
 if(path.includes('?reng='))assert.match(html,/<button class="pd-add-button"[^>]*disabled/, 'Previewing a color never enables ordering before an explicit size is selected');
}

// Exercise the real ProductImage handlers and React keys with a deterministic
// hook harness. The key simulates React's real remount on a changed selection.
let hooks=[],cursor=0,mountedKey;
const react={useId:()=> 'variant-photo-hint',useRef(initial){const index=cursor++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index];},useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value;}];}};
const {default:InteractiveView}=await load('app/product-view.tsx',{...productMocks,react});
function parent(p=product){return InteractiveView({...props,product:p});}
function galleryElement(p=product){return nodes(parent(p)).find(node=>typeof node.type==='function'&&node.type.name==='ProductImage');}
function gallery(p=product){const element=galleryElement(p);assert.ok(element);if(element.key!==mountedKey){hooks=[];mountedKey=element.key;}cursor=0;return element.type(element.props);}
const photo=tree=>nodes(tree).find(node=>node.type==='img'&&node.props.className==='pd-main-image');
const frame=tree=>nodes(tree).find(node=>node.type==='button'&&node.props.className.startsWith('pd-image-frame'));
const thumbs=tree=>nodes(tree).find(node=>node.props?.className==='pd-thumbs');
browserUrl='https://restamarket.az'+red30Path;
let tree=gallery();assert.equal(photo(tree).props.src,'/media/red-30.jpg');
frame(tree).props.onClick({detail:0});tree=gallery();assert.match(frame(tree).props.className,/pd-image-zoomed/);
photo(tree).props.onError();tree=gallery();assert.equal(photo(tree),undefined,'An image load error is tracked for the current gallery');
const detailButton=nodes(thumbs(tree)).find(node=>node.type==='button'&&nodes(node).some(child=>child.type==='img'&&child.props.src==='/media/detail.jpg'));
assert.ok(detailButton);detailButton.props.onClick();tree=gallery();assert.equal(photo(tree).props.src,'/media/detail.jpg');assert.doesNotMatch(frame(tree).props.className,/pd-image-zoomed/,'Manual thumbnail selection resets zoom and image errors');
const stableKey=galleryElement().key;assert.equal(galleryElement({...product,options:product.options.map(item=>({...item})),images:[...product.images]}).key,stableKey,'Equivalent 30-second catalogue refresh must not reset a manual gallery selection');
assert.equal(photo(gallery({...product,options:product.options.map(item=>({...item})),images:[...product.images]})).props.src,'/media/detail.jpg');
browserUrl='https://restamarket.az'+base+'?reng=yasil';tree=gallery();assert.equal(photo(tree).props.src,'/media/green.jpg');assert.doesNotMatch(frame(tree).props.className,/pd-image-zoomed/);
browserUrl='https://restamarket.az'+red30Path;tree=gallery();assert.equal(photo(tree).props.src,'/media/red-30.jpg','Back navigation restores the previous URL photo, not a later manual/other-color photo');
browserUrl='https://restamarket.az'+base+'?reng=boz';tree=gallery();assert.equal(photo(tree).props.src,'/media/main.jpg');assert.ok(!nodes(thumbs(tree)).some(node=>node.type==='img'&&node.props.src==='/media/red-30.jpg'),'A photo for an earlier selected color is removed from the current gallery');
browserUrl='https://restamarket.az'+red30Path;gallery();const updated={...product,options:product.options.map(item=>item.id==='red30'?{...item,image:'/media/red-updated.jpg'}:item)};
assert.notEqual(galleryElement(updated).key,galleryElement(product).key);assert.equal(photo(gallery(updated)).props.src,'/media/red-updated.jpg','Updating the current option photo resets a stale manual photo');

const originalWindow=globalThis.window;
try{
 const navigations=[];globalThis.window={get location(){return new URL(browserUrl);},history:{pushState(_state,_title,target){navigations.push(target);browserUrl=new URL(target,browserUrl).href;}}};
 browserUrl='https://restamarket.az'+red30Path;
 const picker=nodes(parent()).find(node=>node.type===Picker);assert.ok(picker);
 const green=variants.variantSelection(product,new URL(browserUrl).searchParams).groups.find(group=>group.key==='reng').choices.find(choice=>choice.label==='Yaşıl');
 picker.props.onNavigate(green.href);assert.equal(navigations.length,1);assert.equal(new URL(browserUrl).searchParams.get('olcu'),null);assert.equal(photo(gallery()).props.src,'/media/green.jpg','Real color-navigation handler changes the photo without retaining a previous size');
 assert.equal(variants.variantSelection(product,new URL(browserUrl).searchParams).selectedOption,undefined);
}finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}

const {default:Cart}=await load('app/cart-sheet.tsx',{
 'next/link':Link,'@/lib/language':language,'lucide-react':icons,'@/lib/commerce':commerce,'@/lib/variant-images':images,
 '@/lib/storefront-cart':await load('lib/storefront-cart.ts'),'@/lib/delivery':await load('lib/delivery.ts'),'@/lib/checkout-attempt':{},
 '@/lib/customer-contact':await load('lib/customer-contact.ts'),'./commerce-ui':{CouponBox:()=>null},'./delivery-location-picker':()=>null,'./checkout.css':{},
});
const renderCart=id=>renderToStaticMarkup(createElement(Cart,{products:[product],cart:{[product.id+(id?':'+id:'')]:1},account:null,onChange(){},onCommitted(){},onClose(){}}));
for(const [id,src] of [['green40','/media/green.jpg'],['gray40','/media/main.jpg'],['','/media/main.jpg']])assert.match(renderCart(id),new RegExp('class="sf-cart-thumb"[^>]*><img src="'+src.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"'),'Cart thumbnail matches the actual exact option or generic fallback');

const seo=await load('lib/seo.ts',{'./commerce':commerce});
const graph=seo.productStructuredData(product)['@graph'][0];assert.equal(graph['@type'],'ProductGroup');
assert.deepEqual(graph.hasVariant[0].image,['https://restamarket.az/media/red-30.jpg']);assert.deepEqual(graph.hasVariant[2].image,['https://restamarket.az/media/green.jpg']);assert.deepEqual(graph.hasVariant[3].image,['https://restamarket.az/media/main.jpg','https://restamarket.az/media/detail.jpg']);
assert.equal(graph.url,'https://restamarket.az'+base);assert.equal(seo.productMetadata(product).alternates.canonical,graph.url,'Variant photos do not split the parent canonical');
console.log('PASS: exact/color-only uploaded photo selection, no auto-size/wrong-color preview, SSR URL parity, real gallery error/zoom/manual handlers, stable refresh and updated-photo remount, Back/Forward URL restoration, real navigation handler, exact cart thumbnails and variant JSON-LD images. No live-data or network access.');
