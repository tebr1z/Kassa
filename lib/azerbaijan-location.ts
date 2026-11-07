// Broad service-area guard, not proof of a postal address or an exact border.
// Includes the mainland, islands and Nakhchivan; geocoder results additionally
// require country_code=az. Delivery also requires a route on our Azerbaijan graph.
export function isAzerbaijanCoordinate(lat:number,lng:number){
 return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=38.3&&lat<=42&&lng>=44.7&&lng<=51;
}
export const azerbaijanMapBounds:[[number,number],[number,number]]=[[38.3,44.7],[42,51]];
export const defaultAzerbaijanMapCenter={lat:40.4093,lng:49.8671};
