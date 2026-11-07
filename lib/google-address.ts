export type GoogleAddressPin={lat:number;lng:number};
type Place={formattedAddress?:string;location?:{lat:()=>number;lng:()=>number};fetchFields:(options:{fields:string[]})=>Promise<unknown>};
type PlaceSelectEvent=Event&{placePrediction?:{toPlace:()=>Place}};
export type GoogleAddressWidget=HTMLElement&{disabled:boolean;placeholder:string;requestedLanguage:string;requestedRegion:string;includedRegionCodes:string[]};
export type GooglePlacesApi={importLibrary:(name:'places')=>Promise<{PlaceAutocompleteElement:new(options:object)=>GoogleAddressWidget}>};
type Options={placeholder:string;language:string;isCurrent:()=>boolean;isBlocked:()=>boolean;version:()=>string;onSelect:(address:string,pin:GoogleAddressPin)=>void;onError:()=>void};
export const googleAddressLanguage=(language:string)=>language==='zh'?'zh-CN':language;

// The current Places widget owns session tokens and the Google attribution.
// Request only delivery fields after a user explicitly selects a prediction.
export async function attachGoogleAddressSearch(api:GooglePlacesApi,host:HTMLElement,options:Options){
 const {PlaceAutocompleteElement}=await api.importLibrary('places');
 if(!options.isCurrent())return null;
 const widget=new PlaceAutocompleteElement({includedRegionCodes:['az'],requestedRegion:'az',requestedLanguage:googleAddressLanguage(options.language)});
 widget.placeholder=options.placeholder;widget.disabled=options.isBlocked();
 widget.setAttribute('aria-label',options.placeholder);
 let active=true,run=0;
 const fail=()=>{if(active&&options.isCurrent()&&!options.isBlocked())options.onError();};
 const select=async(event:Event)=>{
  if(!active||!options.isCurrent()||options.isBlocked())return;
  const attempt=++run,version=options.version();
  try{
   const place=(event as PlaceSelectEvent).placePrediction?.toPlace();if(!place)throw Error('No prediction');
   await place.fetchFields({fields:['formattedAddress','location']});
   if(!active||!options.isCurrent()||options.isBlocked()||attempt!==run||options.version()!==version)return;
   const address=place.formattedAddress?.trim(),lat=place.location?.lat(),lng=place.location?.lng();
   if(!address||lat==null||lng==null||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw Error('Invalid delivery place');
   options.onSelect(address.slice(0,500),{lat:Number(lat.toFixed(6)),lng:Number(lng.toFixed(6))});
  }catch{if(attempt===run&&options.version()===version)fail();}
 };
 const error=()=>{run++;fail();};
 widget.addEventListener('gmp-select',select);widget.addEventListener('gmp-error',error);
 host.replaceChildren(widget);
 return {widget,destroy(){active=false;run++;widget.removeEventListener('gmp-select',select);widget.removeEventListener('gmp-error',error);widget.remove();}};
}
