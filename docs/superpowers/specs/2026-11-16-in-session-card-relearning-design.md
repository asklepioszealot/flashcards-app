# Oturum İçinde Kart Tekrarı Tasarımı

Tarih: 2026-11-16

Durum: Yaklaşım kullanıcı tarafından seçildi; bu belge uygulama öncesi onay bekliyor.

## Amaç ve kapsam

Kullanıcı, zorlandığı kartları aynı çalışma oturumunda yeniden görmek istiyor. Kart, “Tamam” yanıtına kadar çalışmaya geri katılacak. “Bilmiyorum” sonrasında varsayılan olarak 3, “Tekrar” sonrasında 5 başka kart gösterilecek. Bu iki sayı, mevcut punto ayarları panelinden hesap bazında değiştirilebilecek.

Bu değişiklik çalışma sırasını, değerlendirme davranışını, ayarları ve oturumun kaydedilmesini birlikte etkiliyor. Mevcut JavaScript/Vite yapısı ve hesap bazlı çalışma durumu kullanılacak.

### Kullanıcının belirlediği kurallar

- “Tamam” kartın oturum içindeki tekrarını sonlandırır.
- Her “Bilmiyorum” yanıtı kartı 3 başka kart sonrasına; her “Tekrar” yanıtı 5 başka kart sonrasına yeniden sıraya koyar.
- Bu süreç aynı oturumda birden fazla kez sürebilir; otomatik tekrar sınırı yoktur.
- Sayılar punto ayarlarının bulunduğu panelden değiştirilebilir ve hesaba bağlı saklanır.
- Araya girecek yeterli kart kalmadığında mevcut kartlarla devam edilir.
- İki kart kaldığında kartlar dönüşümlü gelir; tek kart kaldığında “Tamam” denilene kadar aynı kart yeniden sorulur.
- Tekrar gösterimindeki aynı yanıt yeni bir değerlendirmedir; mevcut işareti kaldırmaz.
- Aynı gösterimde değerlendirmeyi kaldırabilme, otomatik ilerlemeyi kapatabilme ve kart başına istatistikler korunur.
- Oturum içindeki yanıtlar, uzun vadeli plan için ayrı çalışma günleri gibi üst üste sayılmaz.

### Hedef dışı

- Anki'nin zaman tabanlı öğrenme adımlarını veya FSRS'yi uygulamak.
- Süreyle bekletmek, yeni bir çalışma modu veya ayrı başlangıç ekranı eklemek.
- Kart kopyalamak, kart kimliklerini ya da dışa aktarılan set içeriğini değiştirmek.
- İstatistikleri cevap sayısı esasına göre yeniden tasarlamak.
- Otomatik sürüm artırımı, masaüstü/Android sürümü, push veya deployment yapmak.

## Yaklaşımlar

### Seçilen: Kalan kart sayısına uyarlanan oturum içi tekrar kuyruğu

Normal kart geçişinden ayrı, kart kimlikleriyle çalışan bir tekrar kuyruğu tutulur. Zamanı gelen tekrar, sıradaki normal kartın önüne geçer. Normal geçiş tükenince bekleyen tekrarlar mevcut kartlarla sürer. Kart verisi, kart numaraları ve istatistikler çoğaltılmaz.

Kullanıcı bu yaklaşımı seçti. İstenen 3/5 kart davranışını doğrudan karşılar, az kart kaldığında bekleme yaratmaz ve mevcut gezinmeyle birlikte yönetilebilir.

### Değerlendirilen: Az kart kaldığında süreyle bekletmek

Araya yeterli kart girmiyorsa tekrar, belirli bir süre dolana kadar bekletilir. Zaman aralığı sağlayabilir ancak zamanlayıcı, bekleme durumu ve ek kurallar gerektirir. Kullanıcının seçtiği akışa uymaz.

### Değerlendirilen uygulama seçeneği: Mevcut kart sırasına kopyalar eklemek

İlk değişiklik daha kısa olabilir ancak kart numaraları, atlama, filtreleme, saklama ve kopya temizliği aynı listeye bağımlı hale gelir. Ayrı tekrar kuyruğu bu sorumlulukları açık tutar; bu seçenek tercih edilmedi.

## Tekrar sırasının kuralları

### Aralık ve adalet

- “3 kart sonra”, mevcut kartın ardından üç başka kart gösterilip dördüncü gösterimde mevcut karta dönülmesidir. “5 kart sonra” için de aynı sayım geçerlidir.
- Aralık, çalışma akışında yeni bir gösterime ilerledikçe azalır. Yanıt vermeden sıradaki normal karta geçmek de gösterim sayılır; bir kartı çevirmek, aynı ekranda yeniden değerlendirmek, geri gitmek veya geçmişi yeniden gezmek sayılmaz.
- Başka bir kartın tekrar gösterimi araya giren kart olarak sayılabilir; araya girenlerin birbirinden farklı kartlar olması gerekmez.
- Her kart için en fazla bir bekleyen tekrar bulunur. Yeni yanıt önceki bekleyen tekrarın yerini alır.
- Zamanı gelen tekrarlar gecikme sırasıyla, eşitlik halinde sıraya alınma sırasıyla gösterilir. Diğer bekleyen kartlar varken aynı kart üst üste seçilmez.
- Henüz gösterilecek normal kart varken 3/5 aralığı uygulanır. Normal geçiş tükenince kalan bekleyen kartlar adil biçimde sırayla döner; ulaşılamayan aralık yüzünden oturum beklemez.
- Yalnızca bir bekleyen kart kaldığında sonraki gösterim aynı karttır. Kartın ön yüzü yeniden açılır; kullanıcı cevabı açıp değerlendirmeye devam eder.
- “Tamam”, bekleyen tekrarı hemen kaldırır. Kalan normal kart ve bekleyen tekrar yoksa son kart ekranda kalır ve ileri geçiş devre dışı olur; kendiliğinden yeni oturum başlamaz.

### Değerlendirme ve düzeltme

- Her yeni gösterimin ilk yanıtı, kartın önceki kaydıyla aynı olsa bile yeni yanıttır.
- Aynı gösterimde farklı yanıt seçmek önceki yanıtı düzeltir; ek bir gösterim veya ek bir tekrar oluşturmaz.
- Aynı gösterimde seçili yanıta yeniden basmak o gösterimin yanıtını kaldırır. Gösterim öncesindeki değerlendirme, bekleyen tekrar ve uzun vadeli plan durumu geri yüklenir. Böylece önceki tamamlanmış çalışmalar yanlışlıkla silinmez.
- Geri dönülüp değiştirilen bir yanıt, kartın güncel yanıtını ve gelecekteki tek bekleyen tekrarını günceller; gezinme geçmişi yeniden oynatılarak ek tekrar üretilmez.
- Yanıt kaldırıldığında otomatik ilerleme yapılmaz. Otomatik ilerleme açıksa geçerli bir yanıt sonrasında sıradaki gösterime geçilir.
- Otomatik ilerleme kapalıysa kart yerinde kalır. İleri düğmesi, sağ ok veya sola kaydırma sıradaki gösterime geçirir. Tek kartın yeniden sorulabilmesi için bekleyen tekrar varken ileri geçiş açık kalır.

## Gezinme, kapsam ve oturum devamlılığı

- Normal kart sırası, tekrar kuyruğu ve gösterim geçmişi ayrı kavramlardır.
- Kart sayacı, mevcut kartın filtrelenmiş normal sıradaki numarasını ve benzersiz kart sayısını gösterir. Tekrarlar toplam kart sayısını büyütmez; “karta atla” aynı normal numaraları kullanır.
- Geri düğmesi/sol ok/sağa kaydırma önceki gösterime döner. Geçmişten ileri gitmek daha önce gösterilmiş kartı açar; kuyruğun mesafelerini tekrar azaltmaz.
- Karta atlama, belirtilen normal kartı açar ve normal geçiş imlecini hedefe taşır. Örneğin 2. karttan 10. karta atlayınca sıradaki normal kart 11'dir; zamanı gelen bir tekrar varsa önce o gösterilebilir. Aradaki 3–9. kartlar görülmüş veya cevaplanmış sayılmaz, otomatik devamın sonuna taşınmaz ve numarayla/geri gezinmeyle erişilebilir kalır. Atlanan kartların önceden bekleyen tekrarları korunur. Atlama, tekrar aralığını yapay biçimde tüketmez. Yeni yanıt verilirse hedef kartın kuyruğu normal kuralla güncellenir.
- Normal geçişin tükenmesi, geçerli atlama/karıştırma konumundan ileri yöndeki normal sıranın sonuna gelmektir; daha önce kullanıcının atladığı kartlar, bekleyen tekrarların kısa aralıklarla sürmesini engellemez.
- Normal ve tam ekran aynı oturum durumunu kullanır. Her yeni kart gösterimi, önceki tasarımdaki gibi ön yüze anında döner.
- Değerlendirme filtresinin mevcut üyelik davranışı korunur: filtre, kullanıcı filtreyi uyguladığında hesaplanır; yanıt sırasında liste kendiliğinden yeniden filtrelenmez.
- Konu veya değerlendirme filtresi değiştiğinde yeni kapsam için normal geçiş kurulur. Bekleyen tekrarlar kaybolmaz: kapsama girenler kalan mesafeleriyle devam eder, kapsam dışındakiler bekler. Kapsam dışındaki kartlar gösterilmez ve bekleme mesafeleri tüketilmez.
- Karıştırma, geçerli kapsamdaki normal kartları yeniden sıralar ve normal geçişi başlatır. Bekleyen tekrarlar ve o günün uzun vadeli plan temelleri korunur.
- Aynı kapsamda setlere dönüp tekrar başlamak ve sayfayı yenilemek, normal sıra/konum ile bekleyen tekrarları geri yükler. Tamamlanmış oturum son konumda açılır; yeni bir yanıt ya da karıştırma ile çalışma sürdürülebilir.
- Set seçimi veya kart içeriği değişirse kimlikler mevcut kartlarla uzlaştırılır. Silinen kartlar geçmişten ve kuyruktan temizlenir; seçili olmayan setlerin kartları gösterilmez. Korunmuş kimliklerin tekrarları saklanır; yeni kartlar normal geçişe katılır.
- İlerlemeyi sıfırlamak, seçili setlerin değerlendirmeleriyle birlikte kuyruk ve ilgili öğrenme döngüsü kayıtlarını temizler.
- Hesap değişiminde bellekteki oturum ve yeni ayarlar temizlenir; yeni hesabın kendi durumu yüklenir.

## Uzun vadeli tekrar planı

Bu bölüm, kullanıcının kabul ettiği “aynı oturumdaki yanıtları ayrı çalışma günleri saymama” ilkesini uygulamak için önerilen ayrıntıdır; belge onayında birlikte değerlendirilir.

- Her kartın yerel takvim günündeki ilk yanıtından önceki tekrar planı temel olarak saklanır.
- Gün içindeki yanıtlar bu temelden hesaplanır; bir önceki birkaç dakika önce hesaplanan aralığa tekrar tekrar uygulanmaz.
- O gün içinde en çok zorlanmayı gösteren yanıt esas alınır: “Bilmiyorum”, ardından “Tekrar”, ardından “Tamam”. Böylece sonradan “Tamam” demek, aynı gün yaşanan unutmayı uzun vadeli plandan silmez.
- `scheduleNextReview`, temele bu etkin yanıtı bir kez uygulayacak şekilde kullanılır. Tekrar, ease ve lapses değerleri gün içindeki her dönüşte birikmez; “Tekrar” sonrasında “Bilmiyorum” olursa hesap aynı temelden daha zor yanıtla güncellenir.
- Son yanıt zamanı, `lastReviewedAt` ve `dueAt` için kullanılır; `lastAssessment` ve kartın görünen işareti kullanıcının son gerçek yanıtını gösterir. Örneğin “Bilmiyorum → Tekrar → Tamam”, görünürde “Tamam” olur ama gelecek aralığı o günkü zorlanmayı hesaba katar.
- Yerel takvim günü değiştiğinde mevcut plan yeni günün temeli olur; devam eden kuyruk korunur. Böylece haftalarca ara verilmiş bir oturum da gelecekteki çalışmaları tek güne sıkıştırmaz.
- Filtre, karıştırma, ekran değişimi veya yenileme o günün temelini sıfırlamaz. Aynı gösterimde yanıt düzeltme/kaldırma işlemi, günün etkin yanıtını da doğru duruma getirir.
- Hesap başına en yeni çalışma durumu kazanır şeklindeki mevcut senkronizasyon politikası korunur; eşzamanlı cihazlardan yanıt birleştirme bu kapsamda değildir.

## Ayarlar ve veri modeli

### Kullanıcıya görünen ayarlar

Mevcut punto paneline “Oturum İçi Tekrar” alanı eklenir:

- “Bilmiyorum: kaç kart sonra?” — varsayılan 3.
- “Tekrar: kaç kart sonra?” — varsayılan 5.
- Kısa açıklama: “Kart, Tamam diyene kadar yeniden sorulur. Az kart kaldığında aralık kısalır.”

Sayılar birbirinden bağımsızdır. Önerilen sınır 1–50 tam sayıdır; boş, geçersiz veya sınır dışı değerler güvenli biçimde normalleştirilir. Değişiklikler hesapta otomatik saklanır ve sonraki yanıtlarda kullanılır; mevcut bekleyen tekrarın konumu kullanıcı ayarı değiştirince sıçramaz.

“Varsayılan fontlara dön” yalnızca punto ayarlarını sıfırlar; bu iki sayıyı değiştirmez. Panelin aç/kapat erişilebilirlik metinleri yalnızca fonttan söz etmek yerine kart ayarlarını kapsar.

### Saklama ve uyumluluk

- Yeni alanlar mevcut `reviewPreferences` içinde tutulur: `dunnoGapCards: 3`, `reviewGapCards: 5`.
- Eski yerel ve uzak kayıtlarda alanlar eksikse 3/5 kullanılır; mevcut bellek hedefi ve tempo ayarları korunur.
- Yerel saklama, çalışma snapshot'ı, uzak durum normalizasyonu ve her iki mevcut uzak okuma/yazma yolu yeni tercih alanlarını korur. Mevcut JSON alanları yeterlidir; veritabanı şema değişikliği gerekmez.
- Oturum durumu `session` altında sürümlü bir alt kayıtta saklanır. Normal sıra/ilerleme, bekleyen tekrarlar ve kalan mesafeleri, gösterim geçmişi/konumu, gösterim değerlendirmeleri ve günlük plan temelleri yeniden yüklemeye yetecek şekilde kaydedilir.
- Kayıtlar kalıcı kart anahtarlarıyla ilişkilendirilir. Bozuk, eski, eksik, yinelenen veya artık var olmayan kimlikler normalleştirilir. Eski oturumlar mevcut kart/konum bilgisinden güvenle başlatılır.
- Tercihler kullanıcıya aittir; set dosyasına veya dışa aktarılan karta yazılmaz. Oturum kaydı mevcut yerel ve uzak saklama mekanizmasını kullanır.

## Yapı ve etkilenen alanlar

- `src/features/study/session-queue.js` gibi saf bir modül: sıra seçimi, bekleme mesafesi, adil son tur, tek bekleyen tekrar kuralı ve oturum normalizasyonu. Tam dosya adı ve iç yapı uygulayıcıya bırakılır.
- `study.js`: gösterim/gezinme akışı, filtre/kapsam uzlaştırma, mevcut sayaçlar ve ayarların arayüz eşlemesi.
- `assessment.js`: yeni gösterim ile aynı gösterimde düzeltmenin ayrımı, tek bekleyen tekrar ve günlük temel üzerinden planlama.
- `scheduler.js`: mevcut uzun vadeli algoritma korunarak günlük döngü hesabına yardımcı saf işlevler gerekirse eklenir.
- `state.js`, `constants.js`, `utils.js`: oturum durumu, varsayılanlar ve ortak normalizasyon.
- `study-state.js`, `platform-adapter.js`, `auth.js`: saklama, geri yükleme, kullanıcı ayrımı ve uyumluluk.
- `bootstrap.js`, `index.html`: iki sayı alanı, erişilebilir etiketler ve olaylar.
- Birim ve smoke testleri: sıralama davranışları, gerçek kullanıcı akışı ve kayıt/geri yükleme.

Uygulama mevcut dalda ve çalışma dizininde yapılacak. Yeni dal/worktree açılmayacak. Gerçek hesaplarda veri değiştirerek doğrulama yapılmayacak; mevcut mock hesaplı smoke altyapısı kullanılacak.

## Kabul ve doğrulama

1. En az altı başka kart varken “Bilmiyorum” yanıtından sonra tam üç başka gösterim, “Tekrar” sonrasında tam beş başka gösterim araya girer.
2. Aynı kartın ikinci ve üçüncü dönüşündeki “Bilmiyorum”/“Tekrar” yeni yanıt sayılır; kart “Tamam” denilene kadar tekrar eder.
3. Kartlar azalınca sıra kalan kartlarla ilerler; iki kart dönüşümlü, tek kart ön yüzüyle yeniden gösterilir. Başka bekleyen kartların aç kalması önlenir.
4. “Tamam” bekleyen tekrarı kaldırır. Son kartta ileri düğmesinin ve otomatik ilerlemenin durumu doğrudur.
5. Otomatik ilerleme kapalıyken yanıt kartı değiştirmez; elle ileri geçiş tekrarları çalıştırır. Geri/ileri, atlama, kaydırma ve tam ekran kuyruk sayımını iki kez tüketmez.
6. Aynı gösterimde yanıt düzeltme veya kaldırma kuyrukta kopya yaratmaz ve önceki gösterimin kaydını yanlışlıkla silmez.
7. Sayaçlar, puanlar ve dışa aktarma aynı kartı çoğaltmaz; font sıfırlama yalnızca fontları etkiler.
8. İki ayar yenileme/hesap değişimi sonrasında doğru kalır; 3/5 varsayılanları ve değer sınırları yerel/uzak normalizasyonda eşleşir.
9. Yenileme, setlere dönme, filtre değiştirme, karıştırma ve kart silme/yeniden içe aktarma geçerli bekleyen tekrarları doğru korur.
10. Aynı gündeki tekrarlı yanıtlar uzun vadeli aralığı/ease/lapses değerlerini üst üste şişirmez. Gün değişimi, düzeltme/kaldırma ve yeniden yükleme davranışı doğrulanır.

Saf sıra ve günlük planlama mantığı için davranış temelli birim testleri; ayarlar, tekrar döngüsü, gezinme ve oturuma devam için anlamlı smoke senaryoları kullanılacak. Uygulama tamamlandığında ilgili birim testleri ile `npm run test:smoke` çalıştırılacak. Herhangi bir sonraki push/deployment öncesinde de çalışma alanının zorunlu smoke kontrolü yeniden çalıştırılacak.

## Uygulayıcıya bırakılan tercihler ve tasarım önerileri

Kullanıcının açık seçimi olmayan, burada önerilen ayrıntılar: 1–50 sınırı, yeni ayarın sonraki yanıtlara uygulanması, en zor günlük yanıtın uzun vadeli planı belirlemesi, gösterim geçmişiyle geri/ileri davranışı ve kapsam değişiminde bekleyen tekrarların askıda korunması. Belge onayı bu davranışları da kapsayacak.

İç nesne adları, saf yardımcıların dosyalara dağılımı, gerekli en az saklama alanı, veri uzlaştırmanın ayrıntıları ve mevcut panel içindeki ufak yerleşim seçimleri uygulayıcıya bırakılır. Kullanıcıya görünen kuralların değişmesi gerekirse uygulamadan önce konuşulur.

## Uygulayıcı kontrolü

Bağımsız değerlendirmede yalnızca karta atlama sonrasındaki normal devamın belirsizliği bildirildi. Mevcut `jumpToCard` ve `nextCard` davranışı temel alınarak hedef numaradan sonraki normal kartla devam etme kuralı yukarıda açıklaştırıldı. Ürün kodu yazılmadı; bu belgenin onayı uygulama planından önce alınacak.
