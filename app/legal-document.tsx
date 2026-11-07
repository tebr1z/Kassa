"use client";

import Link from 'next/link';
import {ArrowLeft,ArrowUp,ChevronDown,ExternalLink,FileText} from 'lucide-react';
import {useTranslations,LanguageSwitcher} from '@/lib/language';
import type {Language} from '@/lib/language-options';
import type {TermsContent,TermsSubsection} from '@/lib/terms-types';
import {BrandLogo} from './brand-logo';
import './legal-document.css';

type Props={content:Record<Language,TermsContent>};

function TextBlocks({content}:{content:TermsSubsection}){
  return <>{content.paragraphs?.map((paragraph,index)=><p key={index}>{paragraph}</p>)}{content.bullets&&<ul>{content.bullets.map((item,index)=><li key={index}>{item}</li>)}</ul>}</>;
}

function Contents({content}:{content:TermsContent}){
  return <ol>{content.sections.map((section,index)=><li key={section.id}><a href={'#terms-'+section.id}><span aria-hidden="true">{String(index+1).padStart(2,'0')}</span>{section.title}</a></li>)}</ol>;
}

export default function LegalDocument({content}:Props){
  const {t,language}=useTranslations();
  const copy=content[language];
  return <div className="legal-page" lang={language}>
    <a className="legal-skip" href="#legal-main">{t('Sənədin mətninə keç')}</a>
    <header className="legal-header">
      <Link className="legal-brand" href="/" aria-label={'RestaMarket — '+t('Ana səhifə')}><BrandLogo size={42}/><strong>RestaMarket</strong></Link>
      <div className="legal-header-actions"><Link className="legal-back" href="/mehsullar"><ArrowLeft size={16} aria-hidden="true"/>{t('Kataloqa qayıt')}</Link><LanguageSwitcher/></div>
    </header>

    <main className="legal-main" id="legal-main" aria-labelledby="terms-title">
      <div className="legal-heading">
        <p className="legal-eyebrow"><FileText size={15} aria-hidden="true"/>{t('Hüquqi məlumat')}</p>
        <h1 id="terms-title">{copy.title}</h1>
        <p className="legal-updated"><span>{t('Son yenilənmə')}</span><strong>{copy.updatedDate}</strong>{copy.version&&<span className="legal-version">{copy.version}</span>}</p>
        {copy.status!=='published'&&<p className="legal-draft" role="note">{t('Sənəd layihəsi — təsdiq gözləyir')}</p>}
        {copy.notice&&<p className="legal-notice">{copy.notice}</p>}
        <div className="legal-intro">{copy.intro.map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
      </div>

      <div className="legal-layout">
        <aside className="legal-sidebar"><nav className="legal-toc" aria-labelledby="legal-contents-title"><h2 id="legal-contents-title">{t('Mündəricat')}</h2><Contents content={copy}/></nav></aside>
        <div className="legal-body">
          <details className="legal-mobile-toc"><summary>{t('Mündəricat')}<ChevronDown size={17} aria-hidden="true"/></summary><nav aria-label={t('Mündəricat')}><Contents content={copy}/></nav></details>
          {copy.sections.map((section,index)=><section className="legal-section" key={section.id} id={'terms-'+section.id} aria-labelledby={'terms-heading-'+section.id}>
            <h2 id={'terms-heading-'+section.id}><span className="legal-section-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>{section.title}</h2>
            <TextBlocks content={section}/>
            {section.subsections?.map((subsection,index)=><div className="legal-subsection" key={index}><h3>{subsection.title}</h3><TextBlocks content={subsection}/></div>)}
          </section>)}
          {!!copy.sources?.length&&<section className="legal-sources" aria-labelledby="legal-sources-title"><h2 id="legal-sources-title">{t('Rəsmi mənbələr')}</h2><ul>{copy.sources.map((source,index)=><li key={index}><a href={source.href} target="_blank" rel="noopener noreferrer">{source.label}<ExternalLink size={14} aria-hidden="true"/><span className="legal-sr-only"> — {t('Yeni pəncərədə açılır')}</span></a></li>)}</ul></section>}
          <a className="legal-top" href="#terms-title">{t('Sənədin əvvəlinə')}<ArrowUp size={15} aria-hidden="true"/></a>
        </div>
      </div>
    </main>

    <footer className="legal-footer"><strong>RestaMarket</strong><nav aria-label={t('Əsas menyu')}><Link href="/mehsullar">{t('Məhsullar')}</Link><Link href="/account">{t('Sifarişlərim')}</Link><Link href="/#contact">{t('Əlaqə')}</Link></nav></footer>
  </div>;
}
