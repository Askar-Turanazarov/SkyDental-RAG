/** Подстановка в шаблон словаря: fill('Найдено: {n}', { n: 3 }) → 'Найдено: 3'. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m))
}
