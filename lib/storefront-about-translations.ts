import type {Language} from './language-options';

// This is the approved RestaMarket copy published on 14 November 2026.
// Match this complete text only: later merchant-written content must not be replaced.
const publishedAboutAz=`RestaMarket — mətbəxinizə və işinizə uyğun seçimlərin ünvanı. Restoran, kafe və ev mətbəxi üçün ləvazimat axtararkən təkcə məhsul deyil, ehtiyacınıza uyğun seçim tapmaq istəyirsiniz. Bizim məqsədimiz həmin seçimi daha rahat etməkdir: lazım olan əşyaları bir yerdə nəzərdən keçirin, məhsulları müqayisə edin və sizə uyğun olanı seçin.

İstər yeni məkan açın, istər mətbəxinizi tamamlayın, istərsə də süfrənizə yeni detallar əlavə edin — hazırlıqdan təqdimata qədər hər mərhələnin öz ehtiyacı var. Kataloqumuzdakı manqal, sac, çaynik və digər mətbəx ləvazimatları ilə tanış olun. Topdan və pərakəndə alış, eləcə də obyektiniz üçün bir neçə məhsulun birlikdə seçilməsi barədə bizimlə danışa bilərsiniz.

Doğru ölçü və uyğun xüsusiyyətlər alışın vacib hissəsidir. Variantı olan məhsullarda mövcud ölçü, rəng və digər seçimləri nəzərdən keçirərək istədiyiniz kombinasiyanı səbətə əlavə edin. Ölçü, material və istifadə məqsədi ilə bağlı tərəddüdünüz varsa, sifarişdən əvvəl bizə yazın. Nə axtardığınızı birlikdə dəqiqləşdirək.

Alış-verişi özünüzə rahat şəkildə planlaşdırın: kataloqda məhsulları araşdırın, göstərilən qiymət və məlumatları yoxlayın, səbətinizi hazırlayın və təhvil üsulunu seçin. Sifarişin mərhələlərini şəxsi hesabınızdan izləyə bilərsiniz. İstər iş yeriniz, istər eviniz üçün alış edin — seçiminiz ehtiyacınıza, zövqünüzə və büdcənizə uyğun olsun.

Məhsulu yaxından görmək və seçim barədə danışmaq üçün sizi Abşeron Ticarət Mərkəzindəki mağazamıza dəvət edirik: Abşeron Mall, sıra 1, korpus 6, mağaza 4. Vaxtınız yoxdursa, WhatsApp vasitəsilə məhsulun adını və ya şəklini göndərin, suallarınızı bizə yazın. RestaMarket-də sadəcə sifariş verməyin — mətbəxiniz üçün doğru seçimi bizimlə birlikdə tapın.`;

const translations:Record<Exclude<Language,'az'>,string>={
  ru:`RestaMarket — место, где вы найдёте подходящие товары для своей кухни и бизнеса. Выбирая принадлежности для ресторана, кафе или домашней кухни, вы ищете не просто товар, а решение, которое соответствует вашим потребностям. Наша цель — сделать этот выбор удобнее: просматривайте всё необходимое в одном месте, сравнивайте товары и выбирайте то, что подходит именно вам.

Открываете ли вы новое заведение, дополняете оснащение кухни или обновляете сервировку — у каждого этапа, от приготовления до подачи, есть свои потребности. Ознакомьтесь с мангалами, саджами, чайниками и другими кухонными принадлежностями в нашем каталоге. Обсудите с нами оптовые и розничные покупки, а также подбор нескольких товаров для вашего заведения.

Правильный размер и подходящие характеристики — важная часть покупки. Если у товара есть варианты, ознакомьтесь с доступными размерами, цветами и другими параметрами и добавьте нужное сочетание в корзину. Если вы сомневаетесь в размере, материале или назначении товара, напишите нам до оформления заказа. Вместе уточним, что именно вы ищете.

Планируйте покупки так, как вам удобно: изучайте товары в каталоге, проверяйте указанные цены и информацию, собирайте корзину и выбирайте способ получения. За этапами выполнения заказа можно следить в личном кабинете. Покупаете ли вы для работы или дома — пусть ваш выбор соответствует вашим потребностям, вкусу и бюджету.

Приглашаем вас в наш магазин в торговом центре Abşeron, чтобы увидеть товары вблизи и обсудить выбор: Abşeron Mall, ряд 1, корпус 6, магазин 4. Если у вас нет времени приехать, отправьте название или фото товара через WhatsApp и задайте нам свои вопросы. Не просто оформляйте заказ в RestaMarket — найдите вместе с нами подходящее решение для своей кухни.`,
  en:`RestaMarket — a place to find the right choices for your kitchen and business. When looking for supplies for a restaurant, café or home kitchen, you want more than a product: you want something that meets your needs. Our aim is to make that choice easier. Browse the essentials in one place, compare products and choose what works for you.

Whether you are opening a new venue, completing your kitchen or adding new touches to your table, every stage from preparation to serving has its own needs. Explore the grills, saj griddles, kettles and other kitchen essentials in our catalogue. Talk to us about wholesale and retail purchases, or about selecting several products together for your business.

The right size and suitable features are an important part of any purchase. For products with variants, explore the available sizes, colours and other options, then add your preferred combination to the cart. If you are unsure about the size, material or intended use, write to us before placing your order. Let’s work out exactly what you are looking for.

Plan your shopping in a way that suits you: explore the catalogue, check the displayed prices and information, prepare your cart and choose how to receive your order. You can follow your order’s progress in your account. Whether you are shopping for your workplace or your home, choose what fits your needs, taste and budget.

We invite you to our store at Abşeron Trade Centre to see the products up close and discuss your choices: Abşeron Mall, row 1, building 6, shop 4. If you cannot visit, send us the product name or a photo on WhatsApp and ask us your questions. Don’t just place an order at RestaMarket — find the right choice for your kitchen together with us.`,
  tr:`RestaMarket — mutfağınıza ve işinize uygun seçeneklerin adresi. Restoran, kafe ve ev mutfağı için malzeme ararken yalnızca bir ürün değil, ihtiyacınıza uygun bir seçim bulmak istersiniz. Amacımız bu seçimi kolaylaştırmak: ihtiyacınız olanları tek bir yerde inceleyin, ürünleri karşılaştırın ve size uygun olanı seçin.

İster yeni bir işletme açın, ister mutfağınızı tamamlayın, ister sofranıza yeni detaylar ekleyin — hazırlıktan sunuma kadar her aşamanın kendine özgü ihtiyaçları vardır. Kataloğumuzdaki mangalları, sacları, çaydanlıkları ve diğer mutfak gereçlerini keşfedin. Toptan ve perakende alışverişin yanı sıra işletmeniz için birden fazla ürünü birlikte seçmek konusunda da bizimle görüşebilirsiniz.

Doğru ölçü ve uygun özellikler, alışverişin önemli bir parçasıdır. Seçenekleri olan ürünlerde mevcut ölçü, renk ve diğer özellikleri inceleyerek istediğiniz kombinasyonu sepete ekleyin. Ölçü, malzeme veya kullanım amacı konusunda kararsızsanız sipariş vermeden önce bize yazın. Ne aradığınızı birlikte netleştirelim.

Alışverişinizi size uygun şekilde planlayın: katalogdaki ürünleri inceleyin, gösterilen fiyatları ve bilgileri kontrol edin, sepetinizi hazırlayın ve teslim alma yöntemini seçin. Siparişinizin aşamalarını hesabınızdan takip edebilirsiniz. İster iş yeriniz ister eviniz için alışveriş yapın — seçiminiz ihtiyacınıza, zevkinize ve bütçenize uygun olsun.

Ürünleri yakından görmek ve seçenekleri konuşmak için sizi Abşeron Ticaret Merkezi’ndeki mağazamıza davet ediyoruz: Abşeron Mall, sıra 1, blok 6, mağaza 4. Gelmeye vaktiniz yoksa WhatsApp üzerinden ürünün adını veya fotoğrafını gönderin, sorularınızı bize yazın. RestaMarket’te yalnızca sipariş vermeyin — mutfağınız için doğru seçimi bizimle birlikte bulun.`,
  zh:`RestaMarket——为您的厨房与生意找到合适之选。无论是为餐厅、咖啡馆还是家庭厨房采购用品，您需要的不只是一件商品，更是符合实际需求的选择。我们的目标是让挑选更轻松：在同一个地方浏览所需用品，比较不同商品，选出适合您的产品。

无论您正在筹备新店、完善厨房配置，还是为餐桌增添新细节，从食材准备到上桌呈现，每个环节都有不同需求。欢迎浏览目录中的烧烤炉、萨吉烤盘、茶壶及其他厨房用品。有关批发、零售，或为您的店铺搭配选购多件商品，都可以与我们沟通。

合适的尺寸与功能，是购物时的重要考量。对于提供多种选项的商品，您可以查看可选尺寸、颜色及其他规格，再将所需组合加入购物车。如果对尺寸、材质或用途有疑问，请在下单前联系我们。让我们一起确认您真正需要的产品。

按照自己的节奏安排采购：浏览目录，核对所示价格与商品信息，准备好购物车，并选择收货方式。您可以在个人账户中查看订单进度。无论为工作场所还是家中采购，都希望您的选择符合需求、喜好与预算。

欢迎前往我们位于 Abşeron 商贸中心的门店，近距离查看商品并与我们交流选购需求：Abşeron Mall，第1排，第6栋，第4号店。如果不方便到店，可通过 WhatsApp 发送商品名称或照片，并告诉我们您的问题。在 RestaMarket，不只是下单——让我们一起为您的厨房找到合适之选。`,
};

function normalizePublishedCopy(value:string):string{
  return value.replace(/\r\n?/g,'\n').trim().replace(/\s+/gu,' ');
}

const normalizedPublishedAbout=normalizePublishedCopy(publishedAboutAz);

/** Localize the approved copy without modifying custom merchant content. */
export function localizeStorefrontAbout(value:string,language:Language):string{
  if(language==='az'||normalizePublishedCopy(value)!==normalizedPublishedAbout)return value;
  return translations[language]??value;
}

