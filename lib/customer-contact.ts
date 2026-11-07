// HTML pattern uses Unicode Sets (v), which requires escaping parentheses too.
// Detailed plausibility is checked by the shared helper, not by HTML alone.
export const customerPhonePattern = '[+0-9 \\(\\)\\-]{7,32}';

const phoneExampleError='Əlaqə telefonunu düzgün yazın. Məsələn: 050 123 45 67 və ya +994 50 123 45 67.';
const addressExampleError='Ünvanı düzgün yazın. Məsələn: Bakı, Nizami küçəsi 10.';

// Azerbaijan's 25 February 2026 numbering plan: 9 national digits, including
// mobile 10/50/51/55/60/70/77/99 and geographic/PSTN destination groups below.
// https://www.itu.int/dms_pub/itu-t/oth/02/02/T020200000F0008PDFE.pdf
const azerbaijanDestination=/^(?:10|12|18|2[0-6]|36|46|50|51|55|60|70|77|88|99)\d{7}$/;

export function normalizeCustomerPhone(value:string):string|null {
  const phone=value.trim();
  if(!/^[+0-9 ()-]{7,32}$/.test(phone))return null;
  const compact=phone.replace(/[ ()-]/g,'');
  if(!/^(?:\+|00)?\d+$/.test(compact))return null;
  const international=compact.startsWith('+')?compact.slice(1):compact.startsWith('00')?compact.slice(2):null;
  let national:string;
  if(international!==null){
    if(!/^[1-9]\d{7,14}$/.test(international))return null;
    if(!international.startsWith('994')){
      // Keep explicitly international contacts for foreign customers. This is
      // syntax/plausibility only, not verification of allocation or ownership.
      return /^[1-9]\d{0,2}0{7,}$/.test(international)?null:'+'+international;
    }
    national=international.slice(3);
  }else if(compact.length===10&&compact.startsWith('0'))national=compact.slice(1);
  else if(compact.length===12&&compact.startsWith('994'))national=compact.slice(3);
  else if(compact.length===9)national=compact;
  else return null;
  // All-zero subscriber fillers are rejected, but real patterned/premium
  // numbers (including repeated nonzero digits) must not be guessed invalid.
  if(!azerbaijanDestination.test(national)||national.slice(2)==='0000000')return null;
  return '+994'+national;
}

export function isCustomerPhone(value: string) {
  return normalizeCustomerPhone(value)!==null;
}

export function customerPhoneError(value:string){
  return isCustomerPhone(value)?'':phoneExampleError;
}

export type CustomerAddressOptions={required?:boolean;maxLength?:number};
export function normalizeCustomerAddress(value:string){
  return value.normalize('NFC').replace(/\s+/gu,' ').trim();
}

const foldAddress=(value:string)=>value.replace(/I/g,'ı').replace(/İ/g,'i').toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/ı/g,'i').replace(/ə/g,'e');
const placeholderWords=new Set(['test','testing','testoviy','sinaq','sinag','deneme','dummy','placeholder','unknown','none','null','undefined','address','unvan','unvani','adres','adresi','тест','тестовыи','тестовыиадрес','адрес','проверка','нет','测试','地址']);
export function isCustomerAddress(value:string,{required=false,maxLength=500}:CustomerAddressOptions={}){
  const address=normalizeCustomerAddress(value);
  if(!address)return !required;
  if(address.length<5||address.length>maxLength||/[\p{Cc}\p{Cf}<>@]/u.test(address))return false;
  if(/https?:|www\.|[\p{L}\p{N}-]+\.(?:az|com|net|org|ru|tr|cn|io)(?:\b|\/)/iu.test(address))return false;
  const words=address.match(/\p{L}[\p{L}\p{M}]*/gu)||[],letters=words.join('');
  if(letters.length<4)return false;
  const foldedWords=words.map(foldAddress),compact=foldedWords.join('');
  if(placeholderWords.has(compact)||foldedWords.every(word=>placeholderWords.has(word)))return false;
  if(/^(.)\1{3,}$/u.test(compact)||/^(.{1,4})\1{2,}$/u.test(compact))return false;
  if(foldedWords.some(word=>/^(?:[asd]{7,}|[asdfgh]{6,}|[qwerty]{6,}|[zxcvbnm]{6,}|[фыва]{6,}|[йцукен]{6,}|(?:qwertyuiop|asdfghjkl|zxcvbnm|йцукенгшщзхъ|фывапролджэ)+)$/u.test(word)))return false;
  return true;
}

export function customerAddressError(value:string,options:CustomerAddressOptions={}){
  return isCustomerAddress(value,options)?'':addressExampleError;
}

export function isCustomerName(value: string) {
  const length = value.trim().length;
  return length >= 2 && length <= 100;
}

export function checkoutContactError({name, phone}: {name: string; phone: string}) {
  if (!isCustomerName(name)) return 'Ad, telefon və məhsulları düzgün daxil edin.';
  return customerPhoneError(phone);
}
