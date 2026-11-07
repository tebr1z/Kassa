const moneyError='Qiyməti 0,01–1 000 000 ₼ aralığında, ən çoxu iki onluq rəqəmlə yazın.';
const percentError='Endirim faizini 0–99,99 aralığında, ən çoxu iki onluq rəqəmlə yazın.';
const discountError='Endirimli qiymət ən azı 0,01 ₼ və əsas qiymətdən aşağı olmalıdır.';
const precise=(value:number)=>Math.abs(value*100-Math.round(value*100))<0.000001;
const numeric=(value:unknown)=>typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;

export function regularPriceCents(value:unknown){
  const number=numeric(value);
  if(!Number.isFinite(number)||number<0.01||number>1000000||!precise(number))throw Error(moneyError);
  return Math.round(number*100);
}

export function priceFromDiscountPercent(regularPrice:unknown,percent:unknown){
  const cents=regularPriceCents(regularPrice),value=numeric(percent);
  if(!Number.isFinite(value)||value<0||value>=100||!precise(value))throw Error(percentError);
  if(value===0)return null;
  // Integer cents and percentage basis points keep browser/server/DB rounding identical.
  const discounted=Math.round(cents*(10000-Math.round(value*100))/10000);
  if(discounted<1||discounted>=cents)throw Error(discountError);
  return discounted/100;
}

export function resolveProductDiscount(regularPrice:unknown,fields:{discountPrice?:unknown;discountPercent?:unknown},existingDiscount?:unknown){
  const cents=regularPriceCents(regularPrice);
  const hasPercent=fields.discountPercent!==undefined;
  const hasPrice=fields.discountPrice!==undefined;
  let price:number|null|undefined;
  if(hasPrice){
    if(fields.discountPrice===null||fields.discountPrice==='')price=null;
    else{
      const value=numeric(fields.discountPrice);
      if(!Number.isFinite(value)||!precise(value)||value<0.01||Math.round(value*100)>=cents)throw Error(discountError);
      price=Math.round(value*100)/100;
    }
  }
  if(hasPercent){
    const calculated=priceFromDiscountPercent(regularPrice,fields.discountPercent);
    if(hasPrice&&price!==calculated)throw Error('Endirim faizi və endirimli qiymət uyğun gəlmir.');
    return calculated;
  }
  if(hasPrice)return price??null;
  // Old clients that omit discount fields must not silently erase an existing promotion.
  const previous=numeric(existingDiscount);
  return Number.isFinite(previous)&&previous>0&&Math.round(previous*100)<cents?Math.round(previous*100)/100:null;
}

export function hasProductDiscount(price:number,originalPrice:number){
  return Number.isFinite(price)&&Number.isFinite(originalPrice)&&price>0&&originalPrice>price;
}

// Floor rather than round up: a badge must never advertise a larger discount
// than the actual cent-denominated saving (and never show a misleading -0%).
export function productDiscountPercent(price:number,originalPrice:number){
  if(!hasProductDiscount(price,originalPrice))return 0;
  const original=Math.round(originalPrice*100),saving=original-Math.round(price*100);
  return Math.floor(saving*10000/original)/100;
}

export function productDiscountLabel(price:number,originalPrice:number,format:(value:number)=>string){
  const percent=productDiscountPercent(price,originalPrice);
  return percent>0?'−'+format(percent).replace(/([.,])00$/,'').replace(/([.,]\d)0$/,'')+'%':'';
}
