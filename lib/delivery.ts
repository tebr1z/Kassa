/** Delivery money is rounded up to a cent, never to a whole kilometre. */
export function deliveryFee(distanceMeters:number,pricePerKm:number,minimumFee:number) {
 if(!Number.isFinite(distanceMeters)||distanceMeters<=0||distanceMeters>2_000_000||!Number.isFinite(pricePerKm)||pricePerKm<=0||!Number.isFinite(minimumFee)||minimumFee<0)throw new Error('Çatdırılma hesablaması düzgün deyil.');
 return Math.ceil(Math.max(minimumFee,distanceMeters/1000*pricePerKm)*100-1e-8)/100;
}
export type DeliverySettings={mode:'manual'|'distance';minimumOrder:number;minimumFee:number;pricePerKm:number;originAddress:string;originLat:number|null;originLng:number|null;browserKey:string};
export type DeliveryQuote={id:string;fee:number;distanceMeters:number;expiresAt:string;address:string;lat:number;lng:number};
export function matchingDeliveryQuote(quote:DeliveryQuote|null,address:string,pin:{lat:number;lng:number}|null,now=Date.now()){
 return Boolean(quote&&pin&&quote.address===address.trim()&&quote.lat===pin.lat&&quote.lng===pin.lng&&Date.parse(quote.expiresAt)>now);
}
