import type {Language} from './language-options';
import type {TermsContent} from './terms-types';
import {termsAz} from './terms-az';
import {termsRu} from './terms-ru';
import {termsEn} from './terms-en';
import {termsTr} from './terms-tr';
import {termsZh} from './terms-zh';

// Versions and dates are author-controlled; rendering never implies consent.
export const termsContent:Record<Language,TermsContent>={az:termsAz,ru:termsRu,en:termsEn,tr:termsTr,zh:termsZh};
