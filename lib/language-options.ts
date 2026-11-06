export type Language='az'|'ru'|'en'|'tr'|'zh';
export const languageOptions:Record<Language,{name:string;description:string;code:string}>={
 az:{name:'Azərbaycan',description:'Azerbaijani',code:'AZ'},
 en:{name:'English',description:'English',code:'EN'},
 ru:{name:'Русский',description:'Russian',code:'RU'},
 tr:{name:'Türkçe',description:'Turkish',code:'TR'},
 zh:{name:'中文',description:'Chinese',code:'中文'},
};
export const languageMenuCopy:Record<Language,{label:string;title:string;hint:string;selected:string}>={
 az:{label:'Dil seçimi',title:'Dilinizi seçin',hint:'Sayt və idarə paneli üçün',selected:'Seçilib'},
 en:{label:'Language',title:'Choose your language',hint:'For the store and dashboard',selected:'Selected'},
 ru:{label:'Язык',title:'Выберите язык',hint:'Для магазина и панели управления',selected:'Выбран'},
 tr:{label:'Dil seçimi',title:'Dilinizi seçin',hint:'Mağaza ve yönetim paneli için',selected:'Seçili'},
 zh:{label:'语言',title:'选择语言',hint:'适用于商店和管理面板',selected:'已选择'},
};
export const isLanguage=(value:unknown):value is Language=>typeof value==='string'&&Object.hasOwn(languageOptions,value);
