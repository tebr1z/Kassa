import Storefront from '../storefront';
import {getPublicCatalog} from '@/lib/public-catalog';
import {privateRobots,publicMetadata} from '@/lib/seo';
export const dynamic='force-dynamic';
export const metadata={...publicMetadata('Sizin üçün seçdik','RestaMarket-in seçilmiş və endirimli məhsullarını kəşf edin.','/sizin-ucun'),robots:privateRobots};
export default async function PicksPage(){return <Storefront picksPage initialCatalog={await getPublicCatalog()}/>;}
