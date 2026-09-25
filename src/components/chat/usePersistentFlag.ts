import { useCallback, useState } from 'react'

/**
 * Флажок, который переживает перезагрузку (localStorage).
 * localStorage может быть недоступен (приватный режим, блокировка
 * сайта) — тогда флажок просто живёт до закрытия вкладки.
 */
export function usePersistentFlag(key: string, initial = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initial : stored === '1'
    } catch {
      return initial
    }
  })

  const set = useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        localStorage.setItem(key, next ? '1' : '0')
      } catch {
        // Не сохранили — не страшно, состояние уже в памяти.
      }
    },
    [key],
  )

  return [value, set]
}
