import type { ReactNode, SVGProps } from 'react'
import type { ServiceItem } from '../i18n/types'

/**
 * Иконки в одном визуальном языке (references/hig/icons.md: иконки
 * разделяют один язык и совпадают по весу с соседним текстом).
 *
 * Сетка 24×24, штрих 1.75, скруглённые концы и стыки, без заливок.
 * Цвет наследуется через currentColor. Все иконки декоративны:
 * смысл несёт соседняя подпись, а у кнопок-иконок подпись задаётся
 * через aria-label на самой кнопке.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ---------- Услуги ---------- */

export const IconImplant = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5c0-.8.7-1.5 1.5-1.5h7c.8 0 1.5.7 1.5 1.5V7c0 1.1-.9 2-2 2H9a2 2 0 0 1-2-2z" />
    <path d="M9.5 9v1.5M14.5 9v1.5" />
    <path d="M8.5 12h7M9 14.5h6M9.5 17h5M10.5 19.5h3" />
    <path d="M12 21v.5" />
  </Icon>
)

export const IconAligner = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 10c0-2.5 3.8-4.5 8.5-4.5s8.5 2 8.5 4.5" />
    <path d="M3.5 10v2.2c0 3.3 3.8 6.3 8.5 6.3s8.5-3 8.5-6.3V10" />
    <path d="M6.5 11.5v1.8M9.2 12.3v2M12 12.6v2.1M14.8 12.3v2M17.5 11.5v1.8" />
  </Icon>
)

export const IconTherapy = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 3.5c-2 0-3.5 1.7-3.5 4 0 2.4.9 4 1.6 6.3.6 2 .7 4.4 1.3 6 .3.8.8 1.2 1.4 1.2 1 0 1.3-1.2 1.6-3 .3-1.7.7-3 2.1-3s1.8 1.3 2.1 3c.3 1.8.6 3 1.6 3 .6 0 1.1-.4 1.4-1.2.6-1.6.7-4 1.3-6 .7-2.3 1.6-3.9 1.6-6.3 0-2.3-1.5-4-3.5-4-1.5 0-2.3 1-4.5 1s-3-1-4.5-1z" />
    <path d="M12 8v4M10 10h4" />
  </Icon>
)

export const IconHygiene = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20 14.5 9.5" />
    <path d="M13 8l3-3a2.1 2.1 0 0 1 3 3l-3 3" />
    <path d="M14.5 9.5 16 11" />
    <path d="M17.5 14.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5zM6.5 4.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" />
  </Icon>
)

export const IconCrown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 8.5c0-2.8 2-4.7 4-4.7 1.2 0 1.8.6 3 .6s1.8-.6 3-.6c2 0 4 1.9 4 4.7 0 2.6-.7 4.2-1.3 6.1-.5 1.7-.7 3.6-1.1 5.6-.3 1.3-.9 2-1.6 2-.9 0-1.1-1-1.4-2.5-.2-1.6-.5-2.7-1.6-2.7s-1.4 1.1-1.6 2.7c-.3 1.5-.5 2.5-1.4 2.5-.7 0-1.3-.7-1.6-2-.4-2-.6-3.9-1.1-5.6C5.7 12.7 5 11.1 5 8.5z" />
    <path d="M8 8.2c.5-1 1.3-1.6 2.2-1.7" />
  </Icon>
)

export const IconKids = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9 10.2v.1M15 10.2v.1" strokeWidth={2.4} />
    <path d="M8.5 14c.9 1.4 2.1 2.1 3.5 2.1s2.6-.7 3.5-2.1" />
  </Icon>
)

/** Связь id услуги → иконка. Тип гарантирует, что ни одна услуга не останется без иконки. */
export const SERVICE_ICONS: Record<ServiceItem['id'], (p: IconProps) => ReactNode> = {
  implants: IconImplant,
  aligners: IconAligner,
  therapy: IconTherapy,
  hygiene: IconHygiene,
  prosthetics: IconCrown,
  kids: IconKids,
}

/* ---------- Интерфейс ---------- */

export const IconPhone = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 4h3.2l1.6 4-2 1.3a11 11 0 0 0 5 5l1.3-2 4 1.6V17a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" />
  </Icon>
)

export const IconPin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
)

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)

export const IconTelegram = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 4.5 3.5 11l5.5 2 2 6 3-4 4.5 3.5z" />
    <path d="M9 13l11.5-8.5" />
  </Icon>
)

export const IconStar = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" />
  </Icon>
)

export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
)

export const IconArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
)

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
)

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const IconChat = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5z" />
    <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeWidth={2.4} />
  </Icon>
)

export const IconSend = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </Icon>
)

export const IconSparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z" />
    <path d="M18.5 16.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
  </Icon>
)

export const IconThumbUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 10.5v9H4.5v-9zM7 10.5l3.5-6.5c1.3 0 2.2 1 2 2.3L12 9.5h5.5a2 2 0 0 1 2 2.3l-1.1 6a2 2 0 0 1-2 1.7H7" />
  </Icon>
)

export const IconThumbDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17 13.5v-9h2.5v9zM17 13.5 13.5 20c-1.3 0-2.2-1-2-2.3l.5-3.2H6.5a2 2 0 0 1-2-2.3l1.1-6a2 2 0 0 1 2-1.7H17" />
  </Icon>
)

export const IconRetry = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
    <path d="M4.5 4.5V9H9" />
  </Icon>
)

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)
