/**
 * Коронка в разрезе — иллюстрация героя.
 *
 * Показывает ровно то, о чём заголовок: слой прозрачной керамики
 * поверх плотной основы — так же устроен и изразец (глазурь поверх
 * черепка). Декоративна, поэтому скрыта от скринридеров: смысл уже
 * передан текстом заголовка.
 */
export function CrownSvg() {
  return (
    <svg
      className="crown"
      viewBox="0 0 360 400"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Эмаль/керамика: полупрозрачная, с глубиной от кобальта к бирюзе */}
        <linearGradient id="crown-enamel" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" style={{ stopColor: "var(--surface)" }} />
          <stop offset="0.55" style={{ stopColor: "color-mix(in srgb, var(--glaze) 18%, var(--surface))" }} />
          <stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--accent) 22%, var(--surface))" }} />
        </linearGradient>
        {/* Плотная основа (дентин / черепок) */}
        <linearGradient id="crown-core" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "color-mix(in srgb, var(--accent) 16%, var(--surface-raised))" }} />
          <stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--accent) 34%, var(--surface-raised))" }} />
        </linearGradient>
        <radialGradient id="crown-glow" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0" style={{ stopColor: "var(--glaze)" }} stopOpacity="0.28" />
          <stop offset="1" style={{ stopColor: "var(--glaze)" }} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Мягкое свечение глазури за формой */}
      <circle cx="180" cy="190" r="170" fill="url(#crown-glow)" />

      {/* Внешний контур коронки: эмалевый слой */}
      <path
        d="M78 128c0-44 30-74 62-74 18 0 28 10 40 10s22-10 40-10c32 0 62 30 62 74 0 40-10 66-20 96-9 27-12 58-18 92-4 22-14 34-26 34-14 0-18-16-22-40-4-26-8-44-16-44s-12 18-16 44c-4 24-8 40-22 40-12 0-22-12-26-34-6-34-9-65-18-92-10-30-20-56-20-96z"
        fill="url(#crown-enamel)"
        style={{ stroke: "var(--accent)" }}
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />

      {/* Разрез: плотная основа внутри эмали */}
      <path
        d="M112 138c0-30 20-50 42-50 12 0 18 7 26 7s14-7 26-7c22 0 42 20 42 50 0 28-7 46-14 66-6 18-9 38-12 58-3 14-9 22-16 22-9 0-11-10-14-26-3-18-6-30-12-30s-9 12-12 30c-3 16-5 26-14 26-7 0-13-8-16-22-3-20-6-40-12-58-7-20-14-38-14-66z"
        fill="url(#crown-core)"
        opacity="0.9"
      />

      {/* Граница «глазурь / основа» — главная мысль рисунка */}
      <path
        d="M112 138c0-30 20-50 42-50 12 0 18 7 26 7s14-7 26-7c22 0 42 20 42 50"
        fill="none"
        style={{ stroke: "var(--glaze)" }}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 6"
      />

      {/* Блик на эмали: керамика блестит, как глазурь */}
      <path
        d="M104 110c6-22 22-36 40-38"
        fill="none"
        style={{ stroke: "var(--surface)" }}
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.9"
      />

    </svg>
  )
}
