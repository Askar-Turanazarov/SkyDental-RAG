/**
 * Единая форма словаря. И ru.ts, и uz.ts обязаны реализовать её
 * целиком, поэтому пропущенный или лишний ключ падает на этапе
 * сборки (`npm run build` → tsc --noEmit), а не в браузере.
 *
 * Добавляете текст — добавляете его здесь, затем в оба словаря.
 */

export type Locale = 'ru' | 'uz'

export interface ServiceItem {
  /** Стабильный ключ: связывает пункт с иконкой и с формой записи. */
  id: 'implants' | 'aligners' | 'therapy' | 'hygiene' | 'prosthetics' | 'kids'
  name: string
  benefit: string
  /** Диапазон цены в сумах, уже отформатированный под локаль. */
  price: string
}

export interface StatItem {
  value: string
  label: string
}

export interface FaqItem {
  q: string
  a: string
}

export interface Dict {
  /** Значение атрибута lang у <html>. */
  htmlLang: string

  nav: {
    services: string
    about: string
    faq: string
    contacts: string
    book: string
    menuOpen: string
    menuClose: string
    skipToContent: string
    /** Подпись переключателя языка для скринридера. */
    langLabel: string
  }

  /** Переключатель оформления в шапке и в мобильном меню. */
  theme: {
    label: string
    auto: string
    light: string
    dark: string
  }

  hero: {
    eyebrow: string
    /** Заголовок разбит на строки, чтобы держать перенос осознанно. */
    titleLines: readonly string[]
    lede: string
    ctaPrimary: string
    ctaSecondary: string
    openUntil: string
    rating: string
    patients: string
  }

  services: {
    eyebrow: string
    title: string
    lede: string
    items: readonly ServiceItem[]
    priceNote: string
    from: string
  }

  about: {
    eyebrow: string
    title: string
    lede: string
    stats: readonly StatItem[]
    body: readonly string[]
    craftTitle: string
    craftBody: string
  }

  faq: {
    eyebrow: string
    title: string
    lede: string
    items: readonly FaqItem[]
  }

  contacts: {
    eyebrow: string
    title: string
    lede: string
    addressLabel: string
    address: string
    phoneLabel: string
    phone: string
    /** Тот же номер без пробелов — для href tel:. */
    /** Пустая строка = номер не задан: ссылка tel: не строится. */
    phoneHref: string
    /** Подсказка у незаполненных демо-данных (адрес, телефон, лицензия). */
    placeholderNote: string
    hoursLabel: string
    hours: string
    telegramLabel: string
    telegram: string
    mapLink: string
    mapAlt: string
    form: {
      title: string
      lede: string
      service: string
      servicePlaceholder: string
      doctor: string
      day: string
      time: string
      today: string
      tomorrow: string
      /** Короткие названия месяцев: янв … дек. */
      months: string[]
      loading: string
      noSlots: string
      name: string
      namePlaceholder: string
      phone: string
      phonePlaceholder: string
      comment: string
      commentPlaceholder: string
      submit: string
      sending: string
      note: string
      errorName: string
      errorPhone: string
      errorSlot: string
      errorTaken: string
      errorTooMany: string
      errorRateLimit: string
      errorFailed: string
      errorLoad: string
      retry: string
      successTitle: string
      /** {doctor}, {date}, {time} */
      successText: string
      successCode: string
      successNote: string
      another: string
      offline: string
      offlineCta: string
    }
  }

  footer: {
    tagline: string
    navTitle: string
    contactsTitle: string
    legalTitle: string
    license: string
    disclaimer: string
    copyright: string
  }

  chat: {
    /** Подпись плавающей кнопки (иконка без текста требует метки). */
    fabOpen: string
    fabClose: string
    title: string
    subtitle: string
    /** Раскрытие природы ответа: generative-ai.md требует прямо сказать,
     *  что отвечает ИИ, и обозначить границы. */
    disclosure: string
    greeting: string
    suggestionsTitle: string
    suggestions: readonly string[]
    inputLabel: string
    inputPlaceholder: string
    send: string
    /** Содержательный статус вместо «Обработка…». */
    thinking: string
    sourcesTitle: string
    notFound: string
    error: string
    retry: string
    /** Не-ИИ путь: живой человек по телефону. */
    fallbackTitle: string
    fallbackCall: string
    feedbackPrompt: string
    feedbackUp: string
    feedbackDown: string
    feedbackThanks: string
    /** Плашка режима заглушки — видна, пока не подключён бэкенд. */
    stubBadge: string
    /** Статус после поиска, до первого слова. {n} — сколько фрагментов нашлось. */
    generating: string
    rateLimited: string
    feedbackCommentLabel: string
    feedbackCommentPlaceholder: string
    feedbackCommentSend: string
    feedbackCommentSkip: string
    /** Режим студента: панель RAG раскрыта, видны оценки и сравнение без RAG. */
    studentMode: string
    studentModeOn: string
    studentModeOff: string
    expand: string
    collapse: string
    /** {n} — номер сноски, {source} — подпись источника. */
    citeLabel: string
    compareButton: string
    compareTitle: string
    compareNote: string
    compareFailed: string
    /** Почему бот отказался. {best} и {threshold} — числа. */
    refusal: {
      belowThreshold: string
      noChunks: string
      modelDeclined: string
    }
    /** Плашка под ответом: откуда он взялся. */
    kind: {
      kb: string
      general: string
      missing: string
    }
    trace: {
      summary: string
      /** {n} — фрагментов в промпте, {ms} — время поиска. */
      summaryMeta: string
      question: string
      condensed: string
      methodHybrid: string
      methodKeyword: string
      semantic: string
      keyword: string
      inPrompt: string
      notInPrompt: string
      /** {best}, {threshold} */
      threshold: string
      passed: string
      failed: string
      model: string
      attempts: string
      attemptOk: string
      attemptError: string
      attemptSkipped: string
      tokens: string
      timing: string
      /** Единица «миллисекунды». */
      ms: string
      demoNote: string
    }
  }
}
