import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function source(file){return ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;}
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const commerceUrl=moduleUrl(await source('lib/commerce.ts'));
const commerce=await import(commerceUrl);
const seo=await import(moduleUrl((await source('lib/seo.ts')).replace('from \'./commerce\'','from '+JSON.stringify(commerceUrl))));
const saved={SITE_URL:process.env.SITE_URL,BIRKASSA_LOCAL:process.env.BIRKASSA_LOCAL,SEO_INDEXING:process.env.SEO_INDEXING};
try{
 delete process.env.SITE_URL;delete process.env.BIRKASSA_LOCAL;delete process.env.SEO_INDEXING;
 assert.equal(seo.siteUrl(),'https://restamarket.az');
 assert.equal(seo.canIndex('restamarket.az'),true);
 for(const host of ['localhost','127.0.0.1:5757','restamarket.az.attacker.test','preview.restamarket.az',null])assert.equal(Boolean(seo.canIndex(host)),false);
 process.env.BIRKASSA_LOCAL='1';assert.equal(seo.canIndex('restamarket.az'),false);delete process.env.BIRKASSA_LOCAL;
 process.env.SEO_INDEXING='0';assert.equal(seo.canIndex('restamarket.az'),false);delete process.env.SEO_INDEXING;
 for(const url of ['http://restamarket.az','https://127.0.0.1','https://localhost','https://user:pass@restamarket.az','https://restamarket.az/path','https://restamarket.az/?secret=1']){process.env.SITE_URL=url;assert.throws(seo.siteUrl);}
 delete process.env.SITE_URL;
 const product={id:'public-product-id',code:'123456',name:'Manqal Əla 40 sm',category:'Manqallar',price:50,originalPrice:50,basePrice:80,baseOriginalPrice:100,image:'https://res.cloudinary.com/demo/image/upload/a.jpg',images:[],available:true,description:'Dəmir manqal — 40 sm.',specifications:'Material: Dəmir',options:[]};
 assert.equal(commerce.productPath(product),'/mehsullar/manqal-ela-40-sm/123456');
 const metadata=seo.productMetadata(product);assert.equal(metadata.alternates.canonical,'https://restamarket.az/mehsullar/manqal-ela-40-sm/123456');assert.match(metadata.title,/Manqal/);
 let graph=seo.productStructuredData(product)['@graph'];assert.equal(graph[0]['@type'],'Product');assert.equal(graph[0].offers.price,'50.00');assert.equal(graph[0].offers.priceCurrency,'AZN');assert.equal(graph[1]['@type'],'BreadcrumbList');
 product.options=[{id:'opt-30',label:'30 sm',size:'30 sm',color:'Qara',kind:'Dəmir',price:50,attributes:{'Qalınlıq':'2 mm'}},{id:'opt-40',label:'40 sm',size:'40 sm',color:'Qara',kind:'Dəmir',price:null,attributes:{'Qalınlıq':'3 mm'}}];
 graph=seo.productStructuredData(product)['@graph'];const group=graph[0];assert.equal(group['@type'],'ProductGroup');assert.equal(group.hasVariant[1].offers.price,'80.00');assert.match(group.hasVariant[0].url,/\?olcu=30-sm&reng=qara&nov=demir&secim=/);assert.equal(new Set(group.hasVariant.map(p=>p.sku)).size,2);assert.ok(group.hasVariant[0].additionalProperty.some(p=>p.name==='Qalınlıq'));
 assert.equal(group.url,metadata.alternates.canonical,'All single-page choices share their parent canonical');
 for(const node of group.hasVariant){assert.equal(node.url,node.offers.url);assert.equal(commerce.productOptionFromQuery(product,new URL(node.url).searchParams)?.id,node.sku.replace(product.code+'-',''));}
 const serialized=seo.jsonLd(group);assert.doesNotMatch(serialized,/cost_price|cost_snapshot|warehouse|aggregateRating|ratingValue|InStock/);
 const injection='</script><script>alert(1)</script>\u2028\u2029';const encoded=seo.jsonLd({name:injection});assert.ok(!encoded.includes('<'));assert.deepEqual(JSON.parse(encoded),{name:injection});
 assert.ok(seo.descriptionText('Söz '.repeat(100)).length<=165);assert.equal(seo.descriptionText('<b>Əla</b>  manqal'),'Əla manqal');
 console.log('PASS: Azerbaijani URLs, public-domain canonical, local/desktop noindex, private-data-free Product/variant offers, base-price inheritance, JSON-LD XSS safety.');
}finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
