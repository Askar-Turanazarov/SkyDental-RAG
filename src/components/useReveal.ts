import { useEffect, useRef } from 'react'

/**
 * Скромное появление секции при прокрутке: opacity + сдвиг на 8px.
 * При prefers-reduced-motion CSS сразу показывает финальное состояние,
 * так что хук ничего не ломает и тогда, когда движения нет.
 *
 * Без IntersectionObserver (старые браузеры) контент показывается сразу:
 * содержимое никогда не должно зависеть от анимации.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (!('IntersectionObserver' in window)) {
      el.dataset.visible = 'true'
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            ;(entry.target as HTMLElement).dataset.visible = 'true'
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return ref
}
