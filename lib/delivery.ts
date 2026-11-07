/** Delivery money is rounded up to a cent, never to a whole kilometre. */
export function deliveryFee(distanceMeters:number,pricePerKm:number,minimumFee:number) {
 if(!Number.isFinite(distanceMeters)||distanceMeters<=0||distanceMeters>2_000_000||!Number.isFinite(pricePerKm)||pricePerKm<=0||!Number.isFinite(minimumFee)||minimumFee<0)throw new Error('Çatdırılma hesablaması düzgün deyil.');
 return Math.ceil(Math.max(minimumFee,distanceMeters/1000*pricePerKm)*100-1e-8)/100;
}
export type DeliverySettings={mode:'manual'|'distance';minimumOrder:number;minimumFee:number;pricePerKm:number;originAddress:string;originLat:number|null;originLng:number|null;browserKey:string;freeDistanceKm?:number;freeOrderFrom?:number|null;routingConfigured?:boolean;tileUrl?:string};
/** Distance quotes never trust a client-supplied basket total. The order API
 * applies the threshold again using authoritative goods prices after coupons. */
export function deliveryCharge(settings:Pick<DeliverySettings,'pricePerKm'|'minimumFee'|'freeDistanceKm'|'freeOrderFrom'>,distanceMeters:number,goodsTotal?:number){
 const freeKm=settings.freeDistanceKm??0,freeOrder=settings.freeOrderFrom;
 if(!Number.isFinite(distanceMeters)||distanceMeters<=0||distanceMeters>2_000_000||!Number.isFinite(freeKm)||freeKm<0||freeKm>10000||!Number.isFinite(settings.pricePerKm)||settings.pricePerKm<=0||!Number.isFinite(settings.minimumFee)||settings.minimumFee<0||freeOrder!=null&&(!Number.isFinite(freeOrder)||freeOrder<0)||goodsTotal!==undefined&&(!Number.isFinite(goodsTotal)||goodsTotal<0))throw new Error('Çatdırılma hesablaması düzgün deyil.');
 if(freeOrder!=null&&goodsTotal!==undefined&&Math.round(goodsTotal*100)>=Math.round(freeOrder*100))return 0;
 const chargeableMeters=Math.max(0,distanceMeters-freeKm*1000);
 if(chargeableMeters===0)return 0;
 return Math.ceil(Math.max(settings.minimumFee,chargeableMeters/1000*settings.pricePerKm)*100-1e-8)/100;
}
export type DeliveryQuote={id:string;fee:number;distanceMeters:number;expiresAt:string;address:string;lat:number;lng:number};
export function matchingDeliveryQuote(quote:DeliveryQuote|null,address:string,pin:{lat:number;lng:number}|null,now=Date.now()){
 const normalized=(value:string)=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
 return Boolean(quote&&pin&&normalized(quote.address)===normalized(address)&&quote.lat===pin.lat&&quote.lng===pin.lng&&Date.parse(quote.expiresAt)>now);
}
