import { useLayoutEffect, useRef } from 'react'

/**
 * Скользящая подложка сегментного контрола (.seg). Меряет выбранный
 * пункт и пишет его позицию и ширину в --thumb-x / --thumb-w, а
 * пружинный переход в base.css довозит подложку до места.
 *
 * useLayoutEffect, а не useEffect: замер и запись идут до отрисовки,
 * поэтому подложка ни одного кадра не стоит на старом пункте.
 * ResizeObserver пересчитывает её, когда меняется ширина пунктов —
 * при смене языка или когда догрузился шрифт.
 *
 * Без JS атрибута data-thumb нет, и подложку рисует сам активный
 * пункт — контрол выглядит так же, только без движения.
 */
export function useSegThumb<T extends HTMLElement>(active: unknown) {
  const ref = useRef<T>(null)

  useLayoutEffect(() => {
    const seg = ref.current
    if (!seg) return

    const place = () => {
      const opt = seg.querySelector<HTMLElement>('[data-active="true"]')
      // Нет выбора или контрол скрыт (закрытое мобильное меню): подложку
      // убираем. Когда он покажется, она возникнет сразу на месте, а не
      // вырастет из нулевой ширины.
      if (!opt || !opt.offsetWidth) {
        delete seg.dataset.thumb
        return
      }
      seg.style.setProperty('--thumb-x', `${opt.offsetLeft}px`)
      seg.style.setProperty('--thumb-w', `${opt.offsetWidth}px`)
      seg.dataset.thumb = ''
    }

    place()
    if (!('ResizeObserver' in window)) return
    const ro = new ResizeObserver(place)
    for (const child of seg.children) ro.observe(child)
    return () => ro.disconnect()
  }, [active])

  return ref
}
