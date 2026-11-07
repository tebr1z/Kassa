"use client";
import {createContext,useContext,useEffect,useSyncExternalStore,type ReactNode} from "react";
import {desktopTranslations} from "./desktop-translations";
import {storefrontTranslations} from "./storefront-translations";
import {productRemovalTranslations} from './product-removal-translations';
import {deliveryTranslations} from './delivery-translations';
import {accountUiTranslations} from './account-ui-translations';
import {checkoutTranslations,checkoutTurkishOverrides} from './checkout-translations';
import {Check,Languages,ChevronDown} from "lucide-react";
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuLabel,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuSeparator} from '@/components/ui/dropdown-menu';
import {languageOptions,languageMenuCopy,isLanguage,type Language} from './language-options';
export type {Language} from './language-options';
declare global {interface Window {birkassaDesktop?:{setLanguage:(language:Language)=>void}}}
const LanguageContext=createContext<Language>("az");
let current:Language="az";
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function changeLanguage(language:Language){current=language;listeners.forEach(listener=>listener());}
// Product names and customer-entered data stay exactly as entered in the catalogue.
const rows=[
 ["Mağazalar və kassirlər","Магазины и кассиры","Stores and cashiers","Mağazalar ve kasiyerler","门店与收银员"],
 ["İşçi girişi","Вход сотрудника","Staff sign-in","Personel girişi","员工登录"],
 ["Masaüstü giriş","Вход на компьютере","Desktop sign-in","Masaüstü girişi","桌面登录"],
 ["Veb girişi","Веб-вход","Web sign-in","Web girişi","网页登录"],
 ["Qənaət","Экономия","You save","Kazancınız","节省"],
 ["Əvvəlki qiymət","Прежняя цена","Original price","Önceki fiyat","原价"],
 ["Endirimli qiymət","Цена со скидкой","Sale price","İndirimli fiyat","优惠价"],
 ["Administrator və kassirlər üçün şifrəli giriş. 10 dəqiqə hərəkətsizlikdən sonra panel kilidlənir.","Вход администратора и кассиров по паролю. Блокировка после 10 минут бездействия.","Password sign-in for administrators and cashiers. Locks after 10 minutes of inactivity.","Yönetici ve kasiyerler için şifreli giriş. 10 dakika hareketsizlikte kilitlenir.","管理员及收银员密码登录，闲置10分钟后锁定。"],
 ["Veb administrator","Веб-администратор","Web administrator","Web yöneticisi","网站管理员"],
 ["Yalnız administrator şifrəsi ilə giriş. 10 dəqiqə hərəkətsizlikdən sonra panel kilidlənir.","Вход только с паролем администратора. Панель блокируется после 10 минут бездействия.","Administrator password required. The panel locks after 10 minutes of inactivity.","Yalnızca yönetici şifresiyle giriş. Panel 10 dakika hareketsizlikten sonra kilitlenir.","仅管理员密码可登录。闲置10分钟后面板自动锁定。"],
 ["Veb kassası ayrıca baza ilə işləyir. Masaüstü stok və satışları avtomatik birləşdirilmir.","Веб-касса использует отдельную базу. Остатки и продажи компьютера не объединяются автоматически.","Web POS uses a separate database. Desktop inventory and sales are not merged automatically.","Web kasası ayrı bir veritabanı kullanır. Masaüstü stok ve satışları otomatik birleştirilmez.","网页收银使用独立数据库，桌面库存和销售不会自动合并。"],
 ["Seçiminiz onlayn. Alışınız rahat.","Выбирайте онлайн. Покупайте удобно.","Choose online. Shop with ease.","Online seçin. Rahat alışveriş yapın.","在线挑选，轻松购物。"],
 ["Ödəniş təhvil zamanı","Оплата при получении","Pay on collection","Teslimatta ödeme","收货时付款"],
 ["Məhsulları kəşf et","Открыть каталог","Explore products","Ürünleri keşfet","探索商品"],
 ["Kataloqa keç","Перейти в каталог","Browse catalogue","Kataloğa git","浏览目录"],
 ["Seçmək rahatdır.\nAlmaq daha da.","Выбирать легко.\nПокупать ещё проще.","Easy to choose.\nEasier to enjoy.","Seçmek kolay.\nAlmak daha da kolay.","轻松挑选，\n便捷购买。"],
 ["Yaxşı seçimlər\nburadan başlayır.","Удачный выбор\nначинается здесь.","Great choices\nstart here.","Güzel seçimler\nburada başlar.","美好选择\n从这里开始。"],
 ["YAXININIZDA. SİZİN ÜÇÜN.","РЯДОМ. ДЛЯ ВАС.","CLOSE BY. FOR YOU.","YAKININIZDA. SİZİN İÇİN.","就在身边，为您服务。"],
 ["KOLLEKSİYA","КОЛЛЕКЦИЯ","COLLECTION","KOLEKSİYON","系列"],
 ["Mağazadan götürün","Заберите в магазине","Collect in store","Mağazadan alın","到店取货"],
 ["Hazır olduqda gəlib təhvil alın","Заберите, когда заказ будет готов","Collect when your order is ready","Hazır olduğunda teslim alın","订单备好后到店领取"],
 ["Ünvana sifariş edin","Закажите доставку","Order to your door","Adresinize sipariş verin","送货到家"],
 ["Təhvil üsulunu səbətdə seçin","Выберите способ получения в корзине","Choose delivery at checkout","Teslim şeklini sepette seçin","在购物车选择收货方式"],
 ["Hər addımı izləyin","Следите за каждым шагом","Track every step","Her adımı takip edin","追踪每一步"],
 ["Sifarişiniz şəxsi kabinetinizdə","Ваш заказ в личном кабинете","Your orders in your account","Siparişiniz hesabınızda","在账户中查看订单"],
 ["Bir mağazadan daha yaxın.","Больше, чем просто магазин.","More than a store.","Bir mağazadan daha yakın.","不止是一家商店。"],
 ["Bizimlə əlaqə","Связаться с нами","Contact us","Bize ulaşın","联系我们"],
 ["Sifarişimi izləyim","Отследить заказ","Track my order","Siparişimi izle","追踪我的订单"],
 ["Məhsul və sifarişlə bağlı sizə kömək edək.","Поможем с товаром и заказом.","We can help with products and orders.","Ürün ve sipariş konusunda yardımcı olalım.","我们可以为您解答商品和订单问题。"],
 ["Rahat seçim, rahat sifariş.","Удобный выбор, простой заказ.","Easy choices, simple ordering.","Rahat seçim, kolay sipariş.","轻松选择，便捷下单。"],
 ["Səbətiniz hələ boşdur.","Ваша корзина пока пуста.","Your cart is empty.","Sepetiniz henüz boş.","购物车还是空的。"],
 ["Məhsullara bax","Посмотреть товары","Browse products","Ürünlere bak","浏览商品"],
 ["Sifarişi necə almaq istəyirsiniz?","Как вы хотите получить заказ?","How would you like to receive it?","Siparişi nasıl almak istersiniz?","您希望如何收货？"],
 ["Sifarişinizi necə almaq istəyirsiniz?","Как вы хотите получить заказ?","How would you like to receive your order?","Siparişinizi nasıl almak istersiniz?","您希望如何收到订单？"],
 ["Hazır olduqda gəlib götürün","Заберите, когда будет готово","Collect when ready","Hazır olunca gelip alın","备好后到店领取"],
 ["Ünvanınıza gətirilir","Доставим по вашему адресу","Delivered to your address","Adresinize getirilir","送至您的地址"],
 ["Ödəniş indi tutulmur. Sifarişinizi mağaza təsdiqlədikdən sonra hazırlayır.","Оплата сейчас не взимается. Магазин подготовит заказ после подтверждения.","No payment is taken now. The store prepares your order after confirming it.","Şimdi ödeme alınmaz. Mağaza onayladıktan sonra siparişinizi hazırlar.","现在无需付款，商店确认后将为您备货。"],
 ["Endirim kuponunuz var?","Есть промокод?","Have a coupon?","İndirim kuponunuz var mı?","有优惠券吗？"],
 ["Daxil ol və davam et","Войти и продолжить","Sign in and continue","Giriş yap ve devam et","登录并继续"],
 ["Səbətiniz saxlanılır. Sifariş üçün hesabınıza daxil olun.","Корзина сохранена. Войдите, чтобы оформить заказ.","Your cart is saved. Sign in to order.","Sepetiniz kaydedilir. Sipariş için giriş yapın.","购物车已保存，请登录下单。"],
 ["Bu seçimə uyğun məhsul yoxdur","Товары не найдены","No matching products","Uygun ürün bulunamadı","没有匹配的商品"],
 ["Bütün məhsullar","Все товары","All products","Tüm ürünler","全部商品"],
 ["Məhsullar yüklənir…","Загрузка товаров…","Loading products…","Ürünler yükleniyor…","正在加载商品…"],
 ["Digər","Другое","Other","Diğer","其他"],
 ["Məhsullar","Товары","Products","Ürünler","商品"],
 ["Kateqoriyalar","Категории","Categories","Kategoriler","分类"],
 ["Kateqoriya","Категория","Category","Kategori","分类"],
 ["Model","Модель","Model","Model","型号"],
 ["Hamısı","Все","All","Tümü","全部"],
 ["Seçilmişlər","Избранное","Featured","Öne çıkanlar","精选"],
 ["Seçilmiş","Избранное","Featured","Öne çıkan","精选"],
 ["Seçilmiş məhsullar","Избранные товары","Featured products","Öne çıkan ürünler","精选商品"],
 ["Endirimli","Со скидкой","Sale","İndirimli","优惠"],
 ["Endirimli məhsullar","Товары со скидкой","Sale products","İndirimli ürünler","优惠商品"],
 ["Sizin üçün seçdik","Мы выбрали для вас","Picked for you","Sizin için seçtik","为您精选"],
 ["Haqqımızda","О нас","About us","Hakkımızda","关于我们"],
 ["Əlaqə","Контакты","Contact","İletişim","联系我们"],
 ["Hesabım","Мой аккаунт","My account","Hesabım","我的账户"],
 ["Səbətim","Корзина","My cart","Sepetim","购物车"],
 ["Səbətə əlavə et","В корзину","Add to cart","Sepete ekle","加入购物车"],
 ["Səbətə bax","Открыть корзину","View cart","Sepete bak","查看购物车"],
 ["Məhsul axtarın","Найти товар","Search products","Ürün arayın","搜索商品"],
 ["Axtarışı təmizlə","Очистить поиск","Clear search","Aramayı temizle","清除搜索"],
 ["Kataloqa qayıt","Назад в каталог","Back to catalogue","Kataloğa dön","返回目录"],
 ["Kataloq","Каталог","Catalogue","Katalog","商品目录"],
 ["Axtardığınız seçimlər","Найдите свой выбор","Find your next favourite","Aradığınız seçenekler","发现心仪好物"],
 ["Sırala","Сортировка","Sort by","Sırala","排序"],
 ["Ada görə","По названию","Name","Ada göre","名称"],
 ["Əvvəl ucuz","Сначала дешевле","Price: low to high","Önce ucuz","价格从低到高"],
 ["Əvvəl baha","Сначала дороже","Price: high to low","Önce pahalı","价格从高到低"],
 ["Əvvəl endirimli","Сначала скидки","Discount first","Önce indirimli","优惠优先"],
 ["Məhsulları kəşf edin","Откройте товары","Explore products","Ürünleri keşfedin","探索商品"],
 ["Məhsul haqqında","О товаре","Product details","Ürün hakkında","商品详情"],
 ["Anbarda mövcuddur","В наличии","In stock","Stokta mevcut","有现货"],
 ["Hazırda stokda yoxdur","Нет в наличии","Out of stock","Stokta yok","暂时缺货"],
 ["Stokda yoxdur","Нет в наличии","Out of stock","Stokta yok","缺货"],
 ["Satış vahidi","Единица продажи","Sales unit","Satış birimi","销售单位"],
 ["Ölçü / rəng / növ","Размер / цвет / тип","Size / colour / type","Ölçü / renk / tür","尺寸 / 颜色 / 类型"],
 ["Seçim edin","Выберите вариант","Choose an option","Seçim yapın","请选择规格"],
 ["Ölçü, rəng və ya növü seçin","Выберите размер, цвет или тип","Choose size, colour or type","Ölçü, renk veya tür seçin","请选择尺寸、颜色或类型"],
 ["Bağla","Закрыть","Close","Kapat","关闭"],
 ["Saxla","Сохранить","Save","Kaydet","保存"],
 ["Ləğv et","Отмена","Cancel","İptal","取消"],
 ["Redaktə et","Изменить","Edit","Düzenle","编辑"],
 ["Sifarişlərim","Мои заказы","My orders","Siparişlerim","我的订单"],
 ["Mağazadan götürmə","Самовывоз","Store pickup","Mağazadan teslim","到店自提"],
 ["Ünvana çatdırılma","Доставка","Delivery","Adrese teslim","送货上门"],
 ["Çatdırılma ünvanı","Адрес доставки","Delivery address","Teslimat adresi","送货地址"],
 ["Sifarişi tamamla","Оформить заказ","Checkout","Siparişi tamamla","结算"],
 ["Sifarişi təsdiqlə","Подтвердить заказ","Confirm order","Siparişi onayla","确认订单"],
 ["Səbətə qayıt","Назад в корзину","Back to cart","Sepete dön","返回购物车"],
 ["Yekun məbləğ","Итого","Total","Toplam","总计"],
 ["Endirim","Скидка","Discount","İndirim","折扣"],
 ["Kupon kodu","Промокод","Coupon code","Kupon kodu","优惠码"],
 ["Kodu daxil edin","Введите код","Enter code","Kodu girin","输入优惠码"],
 ["Tətbiq et","Применить","Apply","Uygula","应用"],
 ["Ad","Имя","Name","Ad","姓名"],
 ["Nömrə","Телефон","Phone","Telefon","电话"],
 ["Mesaj","Сообщение","Message","Mesaj","留言"],
 ["Göndər","Отправить","Send","Gönder","发送"],
 ["Bizə yazın","Напишите нам","Message us","Bize yazın","给我们留言"],
 ["Bir sualınız var?","Есть вопросы?","Have a question?","Sorunuz mu var?","有问题吗？"],
 ["İdarə paneli","Панель управления","Dashboard","Kontrol paneli","控制台"],
 ["Satış / POS","Продажи / POS","Sales / POS","Satış / POS","销售 / 收银"],
 ["Anbar","Склад","Inventory","Depo","库存"],
 ["Sifarişlər","Заказы","Orders","Siparişler","订单"],
 ["Satınalma","Закупки","Purchasing","Satın alma","采购"],
 ["Maliyyə","Финансы","Finance","Finans","财务"],
 ["İnsan resursları","Персонал","Human resources","İnsan kaynakları","人力资源"],
 ["Hesabatlar","Отчёты","Reports","Raporlar","报表"],
 ["Nəzarət jurnalı","Журнал аудита","Audit log","Denetim kaydı","审计日志"],
 ["Tənzimləmələr","Настройки","Settings","Ayarlar","设置"],
 ["Yeni satış","Новая продажа","New sale","Yeni satış","新销售"],
 ["Yeni məhsul","Новый товар","New product","Yeni ürün","新商品"],
 ["Məhsul adı","Название товара","Product name","Ürün adı","商品名称"],
 ["Alıcı","Покупатель","Buyer","Alıcı","买方"],
 ["Nağd ödəniş","Оплата наличными","Cash payment","Nakit ödeme","现金支付"],
 ["Kart","Карта","Card","Kart","银行卡"],
 ["Qarışıq","Смешанная","Split payment","Karma","组合支付"],
 ["Çeki gözlət","Отложить чек","Hold receipt","Fişi beklet","挂单"],
 ["Müştəri","Клиент","Customer","Müşteri","客户"],
 ["Qaiməni çap et","Печать накладной","Print invoice","Fatura yazdır","打印发票"],
 ["Onlayn mağazanız","Ваш интернет-магазин","Your online store","Online mağazanız","您的在线商店"],
 ["Məhsullar və seçimlər","Товары и варианты","Products and options","Ürünler ve seçenekler","商品与规格"],
 ["Məhsul şəkilləri","Фото товаров","Product photos","Ürün fotoğrafları","商品图片"],
 ["Ana səhifə","Главная","Home","Ana sayfa","首页"],
 ["Bağlantılar","Подключения","Connections","Bağlantılar","连接"],
 ["Məhsul idarəsi","Управление товарами","Manage products","Ürün yönetimi","商品管理"],
 ["Endirim kuponları","Промокоды","Discount coupons","İndirim kuponları","优惠券"],
 ["Dəstək biletləri","Поддержка","Support tickets","Destek talepleri","支持工单"],
 ["Ölçü, rəng və növ","Размер, цвет и тип","Size, colour and type","Ölçü, renk ve tür","尺寸、颜色与类型"],
 ["Ölçü","Размер","Size","Ölçü","尺寸"],
 ["Rəng","Цвет","Colour","Renk","颜色"],
 ["Seçim əlavə et","Добавить вариант","Add option","Seçenek ekle","添加规格"],
 ["Aktiv","Активен","Active","Aktif","启用"],
 ["Deaktiv","Неактивен","Inactive","Pasif","停用"]
];
rows.push(...desktopTranslations.map(row=>[row[0],row[1],row[2],rows.find(existing=>existing[0]===row[0])?.[3]||row[3],row[4]]),...storefrontTranslations,...productRemovalTranslations,...deliveryTranslations,...accountUiTranslations,...checkoutTranslations);
export const translationKeys=rows.map(row=>row[0]);
for(const row of rows)if(checkoutTurkishOverrides[row[0]])row[3]=checkoutTurkishOverrides[row[0]];
const translations=new Map(rows.map(row=>[row[0],row]));
const upperTranslations=new Map(rows.map(row=>[row[0].toLocaleUpperCase("az"),row]));
export function t(text:string):string{const exact=translations.get(text),row=exact||upperTranslations.get(text);const translated=row?.[(["az","ru","en","tr","zh"] as const).indexOf(current)]||text;if(row)return !exact?translated.toLocaleUpperCase(current):translated;const prefix=desktopTranslations.find(entry=>entry[0].endsWith(": ")&&text.startsWith(entry[0]));return prefix?t(prefix[0])+text.slice(prefix[0].length):text;}
export function languageLocale(){return ({az:"az-AZ",en:"en-US",ru:"ru-RU",zh:"zh-CN",tr:"tr-TR"} as const)[current];}
const azMonths=["yanvar","fevral","mart","aprel","may","iyun","iyul","avqust","sentyabr","oktyabr","noyabr","dekabr"];
const azWeekdays:Record<string,string>={Sun:"bazar",Mon:"bazar ertəsi",Tue:"çərşənbə axşamı",Wed:"çərşənbə",Thu:"cümə axşamı",Fri:"cümə",Sat:"şənbə"};
export function languageDate(value:Date){
 if(current!=="az")return value.toLocaleDateString(languageLocale(),{day:"2-digit",month:"long",weekday:"long",timeZone:"Asia/Baku"});
 const parts=new Intl.DateTimeFormat("en-US",{day:"numeric",month:"numeric",weekday:"short",timeZone:"Asia/Baku"}).formatToParts(value);
 const part=(type:string)=>parts.find(item=>item.type===type)?.value||"";
 return `${part("day")} ${azMonths[Number(part("month"))-1]}, ${azWeekdays[part("weekday")]}`;
}
export function languageWeekday(value:Date){return current==="az"?["Baz","B.e","Ç.a","Çər","C.a","Cüm","Şən"][value.getUTCDay()]:value.toLocaleDateString(languageLocale(),{weekday:"short",timeZone:"Asia/Baku"});}
export function languageAmount(value:number){
 if(current!=="az")return value.toLocaleString(languageLocale(),{minimumFractionDigits:2,maximumFractionDigits:2});
 const [whole,fraction]=value.toFixed(2).split(".");return whole.replace(/\B(?=(\d{3})+(?!\d))/g," ")+","+fraction;
}
export function useLanguage(){return useContext(LanguageContext);}
export function LanguageSwitcher(){
 const language=useLanguage(),selected=languageOptions[language],copy=languageMenuCopy[language];
 function selectLanguage(next:string){if(!isLanguage(next))return;changeLanguage(next);try{localStorage.setItem('birkassa-language',next);}catch{}}
 return <div className="language-switcher">
  <DropdownMenu modal={false}>
   <DropdownMenuTrigger asChild><button type="button" className="language-switcher-trigger" aria-label={`${copy.label}: ${selected.name}`} title={`${copy.label}: ${selected.name}`}>
    <span className="language-trigger-icon" aria-hidden="true"><Languages size={17}/></span><span className="language-current-name" lang={language}>{selected.name}</span><span className="language-current-code" aria-hidden="true">{selected.code}</span><ChevronDown className="language-chevron" size={14} aria-hidden="true"/>
   </button></DropdownMenuTrigger>
   <DropdownMenuContent align="end" sideOffset={10} collisionPadding={12} className="language-menu">
    <DropdownMenuLabel className="language-menu-heading"><strong>{copy.title}</strong><span>{copy.hint}</span></DropdownMenuLabel>
    <DropdownMenuSeparator className="language-menu-divider"/>
    <DropdownMenuRadioGroup value={language} onValueChange={selectLanguage} aria-label={copy.title}>
     {(Object.entries(languageOptions) as [Language,typeof selected][]).map(([code,option])=><DropdownMenuRadioItem key={code} value={code} textValue={option.name} className="language-menu-option">
      <span className="language-option-code" aria-hidden="true">{option.code}</span><span className="language-option-text"><strong lang={code}>{option.name}</strong><small lang="en">{option.description}</small></span><span className="language-option-check" aria-hidden="true">{code===language&&<Check size={17}/>}</span>
     </DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>
    <div className="language-menu-footer"><span aria-hidden="true"/><span>{copy.selected}: <strong lang={language}>{selected.name}</strong></span></div>
   </DropdownMenuContent>
  </DropdownMenu>
 </div>;
}
export function LanguageProvider({children}:{children:ReactNode}){
 const language=useSyncExternalStore(subscribe,()=>current,()=>"az" as Language);
 useEffect(()=>{
  try{const saved=localStorage.getItem("birkassa-language");if(isLanguage(saved))changeLanguage(saved);}catch{}
  const onStorage=(event:StorageEvent)=>{if(event.key==="birkassa-language"&&isLanguage(event.newValue))changeLanguage(event.newValue);};
  window.addEventListener("storage",onStorage);return()=>window.removeEventListener("storage",onStorage);
 },[]);
 useEffect(()=>{document.documentElement.lang=language;window.birkassaDesktop?.setLanguage(language);},[language]);
 return <LanguageContext.Provider value={language}><div className="language-utility"><LanguageSwitcher/></div>{children}</LanguageContext.Provider>;
}
