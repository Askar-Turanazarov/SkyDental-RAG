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
    phoneHref: string
    hoursLabel: string
    hours: string
    telegramLabel: string
    telegram: string
    mapLink: string
    mapAlt: string
    form: {
      title: string
      name: string
      namePlaceholder: string
      phone: string
      phonePlaceholder: string
      service: string
      servicePlaceholder: string
      submit: string
      note: string
      errorName: string
      errorPhone: string
      success: string
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
  }
}
