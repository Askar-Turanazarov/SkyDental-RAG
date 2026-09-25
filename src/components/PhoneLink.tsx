import type { ReactNode } from 'react'
import { useT } from '../i18n/LocaleContext'

/**
 * Телефон клиники — ссылкой, пока номер задан, и обычным текстом,
 * пока это заглушка.
 *
 * Номер живёт в словаре (`contacts.phoneHref`). Пустая строка там
 * означает «ещё не заполнено», и тогда строить `tel:` нельзя: ссылка
 * вела бы в никуда, а на телефоне открывала бы звонилку с мусором.
 * Поэтому здесь одна точка принятия решения на все четыре места, где
 * номер показывается: контакты, подвал и два места в чате.
 */
export function PhoneLink({ className, children }: { className?: string; children: ReactNode }) {
  const t = useT()
  const href = t.contacts.phoneHref

  if (!href) {
    return (
      <span className={className} data-placeholder="true" title={t.contacts.placeholderNote}>
        {children}
      </span>
    )
  }

  return (
    <a className={className} href={`tel:${href}`}>
      {children}
    </a>
  )
}
