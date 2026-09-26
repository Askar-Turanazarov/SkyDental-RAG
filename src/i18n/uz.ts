import type { Dict } from './types'

/**
 * Oʻzbek tili (lotin). Qoʻshimcha belgi sifatida U+02BB (oʻ, gʻ)
 * ishlatiladi — bu oʻzbek imlosidagi toʻgʻri belgi va u satr
 * ichida qoʻshtirnoqni buzmaydi.
 */
export const uz: Dict = {
  htmlLang: 'uz',

  nav: {
    services: 'Xizmatlar',
    about: 'Klinika haqida',
    faq: 'Savollar',
    contacts: 'Aloqa',
    book: 'Qabulga yozilish',
    menuOpen: 'Menyuni ochish',
    menuClose: 'Menyuni yopish',
    skipToContent: 'Asosiy mazmunga oʻtish',
    langLabel: 'Sayt tili',
  },

  theme: {
    label: 'Koʻrinish',
    auto: 'Avto',
    light: 'Yorugʻ',
    dark: 'Qorongʻi',
  },

  hero: {
    eyebrow: 'Toshkent · Raqamli stomatologiya',
    titleLines: ['Emalingizdan', 'farq qilmaydigan', 'keramika'],
    lede: 'Toj qoplamani bir qabulda skanerlaymiz, loyihalaymiz va oʻyib tayyorlaymiz. Qolip massasisiz, ikki haftalik vaqtinchalik tishlarsiz, begona laboratoriyaga qatnashsiz.',
    ctaPrimary: 'Qabulga yozilish',
    ctaSecondary: 'Xizmatlarni koʻrish',
    openUntil: '20:00 gacha ochiq',
    rating: '5 dan 4,9',
    patients: '1200 dan ortiq bemor',
  },

  services: {
    eyebrow: 'Xizmatlar',
    title: 'Olti yoʻnalish, bitta ish standarti',
    lede: 'Har bir davolash diagnostikadan boshlanadi va narxi koʻrsatilgan yozma reja bilan tugaydi. Narx ishlar boshlanishidan oldin qatʼiy belgilanadi.',
    from: 'dan',
    priceNote:
      'Narxlar soʻmda koʻrsatilgan va 2026-yil sentabrida yangilangan. Aniq narx koʻrik va suratdan keyin maʼlum boʻladi.',
    items: [
      {
        id: 'implants',
        name: 'Implantatsiya',
        benefit:
          'Implantni raqamli shablon boʻyicha oʻrnatamiz: joylashuvi operatsiyadan oldin hisoblanadi, kesma minimal.',
        price: '6 500 000',
      },
      {
        id: 'aligners',
        name: 'Shaffof aylanerlar',
        benefit:
          'Natijani boshlashdan oldin 3D da koʻrsatamiz. Ovqat vaqtida yechiladi, suratlarda koʻrinmaydi.',
        price: '14 000 000',
      },
      {
        id: 'therapy',
        name: 'Davolash va kanallar',
        benefit:
          'Mikroskop ostida va doim izolyatsiya bilan ishlaymiz. Kanallarni bir tashrifda oʻtamiz.',
        price: '900 000',
      },
      {
        id: 'hygiene',
        name: 'Gigiyena va profilaktika',
        benefit:
          'Ultratovush, Air Flow va silliqlash bir soatda. Choʻtka bilan qayerni oʻtkazib yuborayotganingizni koʻrsatamiz.',
        price: '650 000',
      },
      {
        id: 'prosthetics',
        name: 'Protezlash',
        benefit:
          'Bir qabulda butun keramikadan toj: oʻz tish texnigimiz va klinikadagi stanok.',
        price: '3 200 000',
      },
      {
        id: 'kids',
        name: 'Bolalar qabuli',
        benefit:
          'Birinchi tashrif — davolashsiz tanishuv. Bola kursiga qachon oʻtirishni oʻzi hal qiladi.',
        price: '400 000',
      },
    ],
  },

  about: {
    eyebrow: 'Klinika haqida',
    title: 'Har birini chuqurlashtirish uchun xizmatlar roʻyxatini qisqartirdik',
    lede: 'SkyDental — Amir Temur koʻchasidagi kichik klinika. Uch xona, olti shifokor va devor ortida oʻz tish-texnika laboratoriyasi.',
    stats: [
      { value: '2016', label: 'Ochilgan yil' },
      { value: '6', label: 'Shifokor xodimda' },
      { value: '1 qabul', label: 'Toj tayyorlash muddati' },
      { value: '3 yil', label: 'Ishlarga kafolat' },
    ],
    body: [
      'Oʻz laboratoriyamiz aynan shu binoda — bu qulaylik tafsiloti emas, balki toj qabul kunida tayyor boʻlishining sababi. Shifokor va texnik bitta skanerga qarab, bemor kursida turganida shaklni birgalikda tuzatadi.',
      'Sterilizatsiya yopiq tsikl boʻyicha, har bir yuklama nazorat qilinadi: B sinfi, har kassetada indikator, jurnal uch yil saqlanadi. Soʻrasangiz, jurnalni koʻrsatamiz.',
      'Oʻzimiz oxiriga yetkaza olmaydigan ishni olmaymiz. Agar holat yuz-jagʻ jarrohini talab qilsa, buni birinchi qabulda aytamiz va yoʻllanma beramiz.',
    ],
    craftTitle: 'Nega kobalt va feruza',
    craftBody:
      'Sayt ranglari sirlangan koshinlardan olingan — madrasa peshtoqlaridagi ayni oʻsha koshinlardan. Koshin siri va dental farfor mohiyatan bitta material: zich asosga qotirilgan shishasimon qatlam. Bizning tojlarimiz shu shahar gumbazlarini olti asrdan beri qoplab kelayotgan aynan shu moddadan tayyorlanadi.',
  },

  faq: {
    eyebrow: 'Savollar',
    title: 'Birinchi tashrifdan oldin nima soʻraladi',
    lede: 'Savolingiz bu yerda boʻlmasa, oʻng pastdagi yordamchidan soʻrang yoki qoʻngʻiroq qiling.',
    items: [
      {
        q: 'Konsultatsiya qancha turadi?',
        a: 'Koʻrik va davolash rejasi bilan birlamchi konsultatsiya — 250 000 soʻm. Agar bir oy ichida bizda davolanishni boshlasangiz, bu summa hisobdan chiqariladi.',
      },
      {
        q: 'Implant oʻrnatish ogʻriydimi?',
        a: 'Operatsiya mahalliy behushlik ostida oʻtadi va bitta implantga 40–60 daqiqa ketadi. Ogʻriq operatsiya vaqtida emas, ikkinchi kuni boʻladi: odatda biz bilan beradigan ogʻriq qoldiruvchi yetarli. Ertasi kuni qoʻngʻiroq qilib, tun qanday oʻtganini soʻraymiz.',
      },
      {
        q: 'Toj rostdan bir qabulda tayyorlanadimi?',
        a: 'Ha, bitta tishga butun keramikadan toj uchun. Skanerlash, loyihalash va oʻyish uch soatcha vaqt oladi, uni klinikada oʻtkazasiz. Koʻprik, old tishlarning murakkab estetikasi va implant ustidagi ishlar ikkinchi tashrifni talab qiladi.',
      },
      {
        q: 'Aylanerlar bilan davolash qancha davom etadi?',
        a: 'Tishlarni qanchalik siljitish kerakligiga qarab 6 oydan 18 oygacha. Konsultatsiyada oxirgi holat va kappalarning aniq soni koʻrsatilgan 3D simulyatsiyani — hech narsa toʻlashingizdan oldin — koʻrsatamiz.',
      },
      {
        q: 'Bolalar bilan ishlaysizmi, necha yoshdan?',
        a: 'Uch yoshdan. Birinchi tashrif — faqat tanishuv: bola xohlasa kursiga oʻtiradi, asboblarni ushlab koʻradi, hech narsa davolanmaydi. Bu bepul va 20 daqiqa davom etadi.',
      },
      {
        q: 'Boʻlib-boʻlib toʻlash mumkinmi?',
        a: 'Ha, 3 000 000 soʻmdan yuqori summalarni klinika bilan shartnoma boʻyicha, foizsiz va banksiz 3–6 oyga boʻlamiz. Birinchi toʻlov — ishlar boshlanishidan oldin.',
      },
      {
        q: 'Kafolatga nima kiradi?',
        a: 'Tojlar, qoplamalar va plombalarga uch yil: agar ish jarohat sababidan emas, oʻzidan uchib ketsa yoki zichligini yoʻqotsa, bepul qayta bajaramiz. Bitta shart — yarim yilda bir marta gigiyenaga kelish, buni ham kartada qayd etamiz.',
      },
      {
        q: 'Qayerga mashina qoʻyish mumkin?',
        a: 'Hovlida olti oʻrinli oʻz avtoturargohimiz bor, kirish Shahrisabz koʻchasi tomonidan. Joy boʻlmasa, qarshidagi savdo markazi avtoturargohi — birinchi soat bepul.',
      },
    ],
  },

  contacts: {
    eyebrow: 'Aloqa',
    title: 'Keling yoki yozing',
    lede: 'Biz «Amir Temur xiyoboni» bekatidan oʻn daqiqa masofada joylashganmiz. Telefon orqali yozilish odatda shakldan koʻra tezroq.',
    addressLabel: 'Manzil',
    address: 'Toshkent, Amir Temur koʻchasi, __-uy, __-qavat',
    phoneLabel: 'Telefon',
    phone: '+998 __ ___ __ __',
    phoneHref: '',
    placeholderNote: 'Demo maʼlumot: ishga tushirishdan oldin haqiqiysiga almashtiring',
    hoursLabel: 'Ish vaqti',
    hours: 'Du–Sha, 09:00–20:00 · Yak — dam olish kuni',
    telegramLabel: 'Telegram',
    telegram: '@skydental_uz',
    mapLink: 'Yandeks.Xaritada ochish',
    mapAlt: 'Klinikaning Amir Temur koʻchasidagi joylashuv sxemasi',
    form: {
      title: 'Qabulga arza',
      name: 'Ism',
      namePlaceholder: 'Sizga qanday murojaat qilaylik',
      phone: 'Telefon',
      phonePlaceholder: '+998 __ ___ __ __',
      service: 'Xizmat',
      servicePlaceholder: 'Yoʻnalishni tanlang',
      submit: 'Arzani yuborish',
      note: 'Ish vaqtida qoʻngʻiroq qilamiz. Maʼlumotlarni faqat qabulga yozish uchun ishlatamiz va uchinchi shaxslarga bermaymiz.',
      errorName: 'Ismni kiriting — kamida ikki belgi.',
      errorPhone: '+998 formatida va toʻqqiz raqamli nomer kerak.',
      success:
        'Arza matni nusxalandi. Klinikaning Telegram chatini ochamiz — matnni joylab, yuboring.',
    },
  },

  footer: {
    tagline: '2016-yildan Toshkentdagi raqamli stomatologiya.',
    navTitle: 'Boʻlimlar',
    contactsTitle: 'Aloqa',
    legalTitle: 'Hujjatlar',
    license: 'Oʻzbekiston Respublikasi Sogʻliqni saqlash vazirligining __-____-sonli litsenziyasi.',
    disclaimer:
      'Saytdagi maʼlumot tibbiy konsultatsiya emas va shifokor koʻrigini almashtirmaydi.',
    copyright: '© 2026 SkyDental. Barcha huquqlar himoyalangan.',
  },

  chat: {
    fabOpen: 'Yordamchi bilan chatni ochish',
    fabClose: 'Chatni yopish',
    title: 'SkyDental yordamchisi',
    subtitle: 'Narxlar, xizmatlar va qabul haqidagi savollarga javob beradi',
    disclosure:
      'Klinika materiallari asosida sunʼiy intellekt javob beradi. U xato qilishi mumkin va tashxis qoʻymaydi — buning uchun shifokorga keling.',
    greeting:
      'Assalomu alaykum. Darhol soʻrayman: sizni nima olib keldi — aniq muammo yoki narxlarni bilmoqchimisiz?',
    suggestionsTitle: 'Masalan:',
    suggestions: [
      'Implant qancha turadi?',
      'Toj rostdan bir qabuldami?',
      'Ertaga qanday yozilaman?',
      'Bolalar bilan ishlaysizmi?',
    ],
    inputLabel: 'Savolingiz',
    inputPlaceholder: 'Narxlar, xizmatlar yoki qabul haqida soʻrang',
    send: 'Yuborish',
    thinking: 'Klinika materiallaridan qidirmoqdaman',
    sourcesTitle: 'Manbalar',
    notFound:
      'Bu mening materiallarimda yoʻq, oʻzimdan toʻqib ham aytmayman. Qoʻngʻiroq qiling — administrator aniq javob beradi.',
    error: 'Yordamchi bilan aloqa uzildi.',
    retry: 'Qayta urinish',
    fallbackTitle: 'Tirik odam kerakmi?',
    fallbackCall: 'Klinikaga qoʻngʻiroq qilish',
    feedbackPrompt: 'Javob yordam berdimi?',
    feedbackUp: 'Javob yordam berdi',
    feedbackDown: 'Javob yordam bermadi',
    feedbackThanks: 'Rahmat, hisobga olamiz.',
    stubBadge: 'Demo rejim: soʻzlar boʻyicha qidiruv brauzerning oʻzida, SI modelisiz',
    generating: 'Topilgan parchalar: {n}. Javobni tuzmoqdaman',
    rateLimited: 'Ketma-ket juda koʻp savol. Bir-ikki daqiqa kuting yoki klinikaga qoʻngʻiroq qiling.',
    feedbackCommentLabel: 'Nima notoʻgʻri edi?',
    feedbackCommentPlaceholder: 'Ixtiyoriy: masalan, «narx eskirgan»',
    feedbackCommentSend: 'Yuborish',
    feedbackCommentSkip: 'Oʻtkazib yuborish',
    studentMode: 'Talaba rejimi',
    studentModeOn: 'Talaba rejimi yoqilgan: RAG javobni qanday topishi koʻrinadi',
    studentModeOff: 'RAG javobni qanday topishini koʻrsatish',
    expand: 'Panelni kengaytirish',
    collapse: 'Panelni kichraytirish',
    citeLabel: 'Manba {n}: {source}',
    compareButton: 'Xuddi shu modeldan bilimlar bazasisiz soʻrash',
    compareTitle: 'RAGsiz',
    compareNote: 'Model klinika materiallarisiz javob berdi. Raqamlarni yuqoridagi javob bilan solishtiring.',
    compareFailed: 'RAGsiz javob olib boʻlmadi.',
    refusal: {
      belowThreshold: 'Eng yaxshi moslik {best} chegara {threshold} dan past: bazada mos parcha yoʻq.',
      noChunks: 'Qidiruv bazadan birorta oʻxshash parcha topmadi.',
      modelDeclined: 'Parchalar topildi, lekin model ularda javob topmadi va oʻzidan toʻqimadi.',
    },
    kind: {
      kb: 'Klinika materiallari asosida',
      general: 'Umumiy maʼlumot, klinika materiallaridan emas. Aniqrogʻini shifokor koʻrikda aytadi.',
      missing: 'Klinika materiallarida aniq maʼlumot yoʻq — administrator aytib beradi.',
    },
    trace: {
      summary: 'Javobni qanday topdim',
      summaryMeta: '{n} parcha · qidiruv {ms} ms',
      question: 'Savol',
      condensed: 'Qidiruv uchun aniqlashtirilgan savol',
      methodHybrid: 'Gibrid qidiruv: maʼno (vektorlar) va soʻzlar boʻyicha, RRF birlashtirish',
      methodKeyword: 'Demo: faqat soʻzlar boʻyicha qidiruv',
      semantic: 'maʼno',
      keyword: 'soʻzlar',
      inPrompt: 'promptda',
      notInPrompt: 'kirmadi',
      threshold: 'Yaqinlik chegarasi {threshold} · eng yaxshi moslik {best}',
      passed: 'oʻtdi',
      failed: 'oʻtmadi',
      model: 'Model',
      attempts: 'Urinishlar',
      attemptOk: 'javob berdi',
      attemptError: 'xato',
      attemptSkipped: 'oʻtkazildi',
      tokens: 'tokenlar',
      timing: 'qidiruv {retrieve} ms · javob {generate} ms',
      ms: 'ms',
      demoNote:
        'Backendsiz embedding modeli yoʻq, shuning uchun demo sinonimlarni va boshqa tilni tushunmaydi. Haqiqiy RAGni koʻrish uchun /api/chat ni ulang.',
    },
  },
}
