import './girih.css'

/**
 * Подпись дизайна: girih-сетка в цветах кобальтовой и бирюзовой
 * глазури — фон под всей страницей.
 *
 * Живёт в КОНТЕНТНОМ слое и прокручивается под стеклянной шапкой —
 * стекло подхватывает её цвет. Это то, что предписывает
 * references/hig/branding.md › Best practices: выражать бренд цветом
 * в контентном слое, а не заливкой контролов.
 *
 * Под героем узор в полную силу, ниже — лёгкая фактура: маска силы
 * привязана к документу и уезжает вместе с героем. Сами плитки
 * почти стоят — дальний план параллакса (girih.css).
 *
 * Мотив — восьмилучевая звезда из двух наложенных квадратов,
 * повёрнутых на 45°. Так её и строят на изразцах: не «звёздочка»
 * как иконка, а результат наложения двух простых фигур.
 *
 * Сетка — SVG <pattern>: один изразец повторяется браузером на любую
 * высоту страницы, в DOM не сотни плиток, а одна.
 *
 * Узор чисто декоративный и ничего не сообщает, поэтому скрыт от
 * скринридеров целиком.
 */

/* Мелкий и плотный модуль держится как фактура и не спорит с текстом. */
const TILE = 96

export function GirihPattern() {
  const c = TILE / 2
  // Половина стороны квадрата: два таких квадрата, один повёрнут
  // на 45°, дают восьмилучевую звезду. Углы повёрнутого (half·√2 ≈ 41)
  // остаются внутри ячейки 96×96 — плитка не обрезается.
  const half = TILE * 0.3
  const coreR = TILE * 0.17

  return (
    <div className="girih" aria-hidden="true">
      <div className="girih__mask">
        <div className="girih__layer">
          <svg className="girih__svg" focusable="false">
            <defs>
              <pattern id="girih-tile" width={TILE} height={TILE} patternUnits="userSpaceOnUse">
                <g transform={`translate(${c} ${c})`}>
                  <rect className="girih__line" x={-half} y={-half} width={half * 2} height={half * 2} />
                  <rect
                    className="girih__line"
                    x={-half}
                    y={-half}
                    width={half * 2}
                    height={half * 2}
                    transform="rotate(45)"
                  />
                  <circle className="girih__glaze" r={coreR} />
                  {/* Связки к соседним мотивам. Ячейка рисует свою половину
                      каждой связки до края, соседняя — вторую. */}
                  <path
                    className="girih__tie"
                    d={`M${half} 0H${c}M${-half} 0H${-c}M0 ${half}V${c}M0 ${-half}V${-c}`}
                  />
                </g>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#girih-tile)" />
          </svg>
        </div>
      </div>
    </div>
  )
}
