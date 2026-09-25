import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import './girih.css'

/**
 * Подпись дизайна: girih-сетка в цветах кобальтовой и бирюзовой
 * глазури.
 *
 * Живёт в КОНТЕНТНОМ слое и прокручивается под стеклянной шапкой —
 * стекло подхватывает её цвет. Это то, что предписывает
 * references/hig/branding.md › Best practices: выражать бренд цветом
 * в контентном слое, а не заливкой контролов.
 *
 * Мотив — восьмилучевая звезда из двух наложенных квадратов,
 * повёрнутых на 45°. Так её и строят на изразцах: не «звёздочка»
 * как иконка, а результат наложения двух простых фигур.
 *
 * Узор чисто декоративный и ничего не сообщает, поэтому скрыт от
 * скринридеров целиком.
 */

/* Размер мотива подобран так, чтобы фон читался изразцовой СЕТКОЙ,
   а не обоями: мелкий и плотный модуль держится как фактура и не
   спорит с заголовком. Пропорция viewBox при этом остаётся близкой
   к 3:2, как была. */
const TILE = 96
const COLS = 14
const ROWS = 10
const VIEW_W = TILE * COLS
const VIEW_H = TILE * ROWS

interface Tile {
  key: string
  cx: number
  cy: number
  /** Задержка появления, мс: волна расходится от левого верхнего угла. */
  delay: number
}

function buildTiles(): Tile[] {
  const tiles: Tile[] = []
  const maxDist = Math.hypot(COLS, ROWS)

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const dist = Math.hypot(col + 0.5, row + 0.5)
      tiles.push({
        key: `${row}-${col}`,
        cx: col * TILE + TILE / 2,
        cy: row * TILE + TILE / 2,
        delay: Math.round((dist / maxDist) * 720),
      })
    }
  }
  return tiles
}

export function GirihPattern() {
  const tiles = useMemo(buildTiles, [])

  // Половина стороны квадрата: два таких квадрата, один повёрнут
  // на 45°, дают восьмилучевую звезду.
  const half = TILE * 0.3
  const coreR = TILE * 0.17

  return (
    <div className="girih" aria-hidden="true">
      <svg
        className="girih__svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          {/* Затухание вправо: там SVG коронки, узор не спорит с ним. */}
          <linearGradient id="girih-fade-x" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.6" stopColor="#fff" stopOpacity="0.4" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {/* Затухание вниз: герой мягко переходит в следующую секцию. */}
          <linearGradient id="girih-fade-y" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="girih-mask-x">
            <rect width={VIEW_W} height={VIEW_H} fill="url(#girih-fade-x)" />
          </mask>
          <mask id="girih-mask-y">
            <rect width={VIEW_W} height={VIEW_H} fill="url(#girih-fade-y)" />
          </mask>
        </defs>

        {/* Вложенные маски перемножаются: итог затухает и вправо, и вниз. */}
        <g mask="url(#girih-mask-y)">
          <g mask="url(#girih-mask-x)">
            {tiles.map((tile) => (
              <g
                key={tile.key}
                className="girih__tile"
                style={{ '--girih-delay': `${tile.delay}ms` } as CSSProperties}
                transform={`translate(${tile.cx} ${tile.cy})`}
              >
                <rect
                  className="girih__line"
                  x={-half}
                  y={-half}
                  width={half * 2}
                  height={half * 2}
                />
                <rect
                  className="girih__line"
                  x={-half}
                  y={-half}
                  width={half * 2}
                  height={half * 2}
                  transform="rotate(45)"
                />
                <circle className="girih__glaze" r={coreR} />
                {/* Связки к соседним мотивам: из них складывается сетка. */}
                <line className="girih__tie" x1={half} y1="0" x2={TILE - half} y2="0" />
                <line className="girih__tie" x1="0" y1={half} x2="0" y2={TILE - half} />
              </g>
            ))}
          </g>
        </g>
      </svg>
    </div>
  )
}
