export type TermsSubsection={
  title:string;
  paragraphs?:string[];
  bullets?:string[];
};

export type TermsSection=TermsSubsection&{
  // Stable ASCII identifiers shared by every language; headings are display text.
  id:string;
  subsections?:TermsSubsection[];
};

export type TermsContent={
  status?:'draft'|'published';
  notice?:string;
  version?:string;
  title:string;
  intro:string[];
  // Author-provided, deterministic display date; never generated in the browser.
  updatedDate:string;
  sections:TermsSection[];
  sources?:{label:string;href:string}[];
};
