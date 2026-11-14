// Reviewed generic AI illustrations, not exact SKU photographs. Content-addressed
// URLs retain this disclosure when local/public media is transferred.
export const catalogIllustrations={
 grill:'/api/catalog-media/2710867f00675a88ffbdb11ca096998b2dbcf6da0a64f47f48a439c99efe0cd7',
 chopper:'/api/catalog-media/7d25b43901ed066e57060a7f0b6c5c6fc3285405ed508996f0b997791f0168dd',
 grater:'/api/catalog-media/823572fe172cc384713c1479d4f6351cfacc91256324ce800d53db9edeef5264',
} as const;
const hashes=new Set<string>(Object.values(catalogIllustrations).map(value=>value.split('/').at(-1)!));
export function isCatalogIllustration(value:unknown):boolean{
 if(typeof value!=='string')return false;
 const match=/^\/api\/(?:catalog|desktop)-media\/([a-f0-9]{64})$/.exec(value);
 return Boolean(match&&hashes.has(match[1]));
}
