import type {CatalogProduct,HeroSlide} from './commerce';
export type CatalogBrand={name:string;kind:string;description:string;about:string;logo:string;phone:string;address:string;whatsapp:string;featuredProductId:string|null};
export type ShowcaseCategory={id:string;name:string;image:string};
// Only the explicit public DTO can cross the server/client boundary.
export type PublicCatalog={brand:CatalogBrand|null;products:CatalogProduct[];slides:HeroSlide[];categories:ShowcaseCategory[]};
