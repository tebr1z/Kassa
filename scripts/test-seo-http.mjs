import assert from 'node:assert/strict';
import http from 'node:http';
const markup=html=>[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[char]));
const slugFor=p=>[...p.name].map(ch=>({'ə':'e','Ə':'E','ı':'i','İ':'I','ö':'o','Ö':'O','ü':'u','Ü':'U','ş':'s','Ş':'S','ç':'c','Ç':'C','ğ':'g','Ğ':'G'}[ch]??ch)).join('').replace(/[^0-9A-Za-z]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
const pathFor=p=>'/mehsullar/'+p.code+'-'+slugFor(p)+'/';
export async function verifySeoHttp(origin,productId){
 const catalog=await (await fetch(origin+'/api/catalog')).json();
 const product=catalog.products.find(p=>p.id===productId)||catalog.products.find(p=>p.options.length)||catalog.products[0];assert.ok(product);
 const get=path=>fetch(origin+path,{redirect:'manual',headers:{'User-Agent':'Googlebot'}});
 const path=pathFor(product),response=await get(path),html=await response.text();assert.equal(response.status,200,path);
 assert.equal(response.headers.get('x-robots-tag'),null,'Public product pass cannot inherit the private API/admin noindex header');
 assert.ok(html.includes('<h1 id="pd-product-title" class="pd-title">'+escape(product.name)+'</h1>'),'Product title must exist in real server HTML');
 assert.ok(html.includes('rel="canonical" href="https://restamarket.az'+path+'"'));assert.match(html,/<meta name="description" content="[^\"]+"/);assert.match(html,/<meta name="robots" content="noindex/,'Local previews stay out of search');
 assert.doesNotMatch(html,/cost_price|password_hash|cost_snapshot|sales_warehouse_id/,'Server props stay public');
 const graph=markup(html).flatMap(node=>node['@graph']||[node]);assert.ok(graph.some(node=>['Product','ProductGroup'].includes(node['@type'])));assert.ok(graph.some(node=>node['@type']==='BreadcrumbList'));
 const legacyPaths=['/products/old-name/'+product.code,'/products/'+product.id,'/mehsullar/old-name/'+product.code,'/mehsullar/'+slugFor(product)+'/'+product.code,'/mehsullar/'+product.id,'/mehsullar/'+slugFor(product),'/mehsullar/'+product.code+'-outdated-product-name/','/mehsullar/'+product.code+'-outdated-product-name',path.slice(0,-1)];
 for(const legacy of legacyPaths){const r=await get(legacy);assert.equal(r.status,308,legacy);const target=new URL(r.headers.get('location'),origin);assert.equal(target.pathname,path,'Permanent redirects go straight to code-first canonical: '+legacy);assert.equal(target.search,'');assert.equal((await get(target.pathname)).status,200,'Canonical target has no slash redirect loop');}
 const forgedPath=await fetch(origin+path.slice(0,-1),{redirect:'manual',headers:{'User-Agent':'Googlebot','x-restamarket-product-pathname':path}});assert.equal(forgedPath.status,308,'Caller-supplied path header cannot bypass missing-slash canonicalization');assert.equal(new URL(forgedPath.headers.get('location'),origin).pathname,path);
 const forgedCanonical=await fetch(origin+path,{redirect:'manual',headers:{'x-restamarket-product-pathname':'/mehsullar/forged'}});assert.equal(forgedCanonical.status,200,'Overwriting a forged header prevents canonical redirect loops');
 assert.equal((await get('/products')).headers.get('location'),'/mehsullar');
 for(const missing of ['/mehsullar/not-found/000000','/mehsullar/000000-not-found/','/categories/not-a-category']){const r=await get(missing);assert.equal(r.status,404,missing);assert.match(await r.text(),/noindex/);}
 for(const api of ['/api/catalog','/api/products']){const r=await get(api+'/');assert.equal(r.status,308,'Existing API slash policy is unchanged: '+api);assert.equal(new URL(r.headers.get('location'),origin).pathname,api);assert.equal((await get(api)).status,api==='/api/catalog'?200:401,'Slash handling cannot bypass API permissions');}
 const adminSlash=await get('/admin/');assert.equal(adminSlash.status,308);assert.equal(new URL(adminSlash.headers.get('location'),origin).pathname,'/admin');
 const homeHtml=await (await get('/')).text();assert.ok(homeHtml.includes('href="'+path+'"'),'Home links exist without JavaScript');
 const listHtml=await (await get('/mehsullar')).text();assert.ok(listHtml.includes('href="'+path+'"'));assert.ok(listHtml.includes('<h1>Məhsullar</h1>'));assert.ok(markup(listHtml).some(node=>node['@type']==='CollectionPage'));
 const sitemap=await (await get('/sitemap.xml')).text();assert.ok(sitemap.includes('https://restamarket.az'+path));assert.doesNotMatch(sitemap,/127\.0\.0\.1|localhost|\/admin|\/account|\/products\/|variant=/);for(const item of catalog.products)assert.ok(sitemap.includes('https://restamarket.az'+pathFor(item)),'All products, not only the selected fixture, use code-first canonical sitemap paths');
 for(const category of catalog.categories.filter(c=>catalog.products.some(p=>p.category===c.name))){const r=await get('/categories/'+category.id);assert.equal(r.status,200);assert.ok((await r.text()).includes(escape(category.name)));}
 const robots=await (await get('/robots.txt')).text();assert.match(robots,/Disallow: \/\s/);assert.doesNotMatch(robots,/Sitemap:/);
 const publicRobots=await new Promise((resolve,reject)=>{const req=http.get(origin+'/robots.txt',{headers:{Host:'restamarket.az'}},r=>{let data='';r.on('data',chunk=>data+=chunk);r.on('end',()=>resolve(data));});req.on('error',reject);});
 assert.match(publicRobots,/Sitemap: https:\/\/restamarket\.az\/sitemap\.xml/);assert.match(publicRobots,/Disallow: \/admin/);assert.match(publicRobots,/Allow: \/api\/catalog-media\//);assert.doesNotMatch(publicRobots,/variant=/);
 for(const privatePath of ['/admin','/account']){const r=await get(privatePath);assert.match(await r.text(),/<meta name="robots" content="noindex/);}
 if(product.options.length){
  const option=product.options.at(-1),group=graph.find(node=>node['@type']==='ProductGroup'),variant=group.hasVariant.find(node=>node.sku===(product.code||product.id)+'-'+option.id);assert.ok(variant);
  const deepLink=new URL(variant.url),r=await get(deepLink.pathname+deepLink.search),selectedHtml=await r.text();assert.equal(r.status,200);assert.ok(selectedHtml.includes('aria-current="true"'),'Readable variant URL is preselected in SSR');assert.ok(selectedHtml.includes('rel="canonical" href="https://restamarket.az'+path+'"'));assert.ok(selectedHtml.includes('href="'+escape(deepLink.pathname+deepLink.search)+'"'),'Choices are crawlable links');
  const choice=selectedHtml.match(/<a[^>]+class="pd-variant-option"[^>]+aria-current="true"[^>]*>([\s\S]*?)<\/a>/)?.[1];assert.ok(choice);assert.doesNotMatch(choice,/<(?:small|b)>|\bAZN\b|₼/,'Choice chips have no prices or repeated detail block');
  const legacy=await get(path+'?variant='+option.id);assert.equal(legacy.status,200);assert.ok((await legacy.text()).includes('aria-current="true"'),'Legacy UUID links still preselect their choice');
  for(const old of legacyPaths){
   for(const selection of [deepLink.search,'?variant='+option.id]){
    const redirected=await get(old+selection);assert.equal(redirected.status,308,'Selected legacy URL redirects: '+old+selection);const target=new URL(redirected.headers.get('location'),origin);assert.equal(target.pathname,path);assert.equal(target.search,deepLink.search,'Exact selected choice survives both readable and UUID redirects');
   }
  }
  const invalid=await get(path+'?olcu=definitely-not-a-choice');assert.equal(invalid.status,200);assert.doesNotMatch(await invalid.text(),/class="pd-variant-option"[^>]*aria-current="true"/,'Unknown choice is not silently replaced with another price');
 }
 console.log('PASS: code-first trailing-slash canonical for every product, direct308 old/renamed/UUID links, exact variant preservation, unchanged API/admin slash guards, server HTML,404s,sitemap and private noindex.');
}
if(process.argv[1]?.endsWith('test-seo-http.mjs'))await verifySeoHttp(process.env.TEST_ORIGIN||'http://127.0.0.1:5757');
