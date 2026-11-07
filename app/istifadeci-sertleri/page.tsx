import LegalDocument from '../legal-document';
import {termsContent} from '@/lib/terms-content';
import {privateRobots,publicMetadata} from '@/lib/seo';

export const dynamic='force-dynamic';
export const metadata={
  ...publicMetadata('İstifadəçi şərtləri','RestaMarket istifadəçi şərtləri: sayt, hesab və sifarişlərlə bağlı məlumat.','/istifadeci-sertleri/'),
  ...(termsContent.az.status==='published'?{}:{robots:privateRobots}),
};

export default function TermsPage(){return <LegalDocument content={termsContent}/>;}
