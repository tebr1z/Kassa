import type {CatalogProduct,ProductOption} from './commerce';
import type {VariantSelectionState} from './variant-selection';

type ImageProduct=Pick<CatalogProduct,'image'|'images'>;

// The server already resolves uploaded media into safe public URLs. Keep the
// selected option's photo separate from the general gallery: a different color
// must never inherit the previous color's photo through component state.
export function productOptionImage(product:ImageProduct,option?:ProductOption){
 return option?.image?.trim()||product.image||product.images?.find(Boolean)||'';
}

export function variantPreviewImage(selection:VariantSelectionState){
 if(!selection.valid)return '';
 if(selection.selectedOption)return selection.selectedOption.image?.trim()||'';
 // Previewing a color does not select a size. All candidates already match the
 // explicit color (and any further chosen dimensions) in variantSelection.
 if(!selection.groups.some(group=>group.key==='reng'&&group.selectedValue))return '';
 return selection.candidates.find(option=>option.image?.trim())?.image?.trim()||'';
}

export function productGalleryImages(product:ImageProduct,preferredImage=''){
 const main=product.images?.length?product.images:[product.image];
 return [...new Set([preferredImage,...main].map(image=>image?.trim()||'').filter(Boolean))];
}
