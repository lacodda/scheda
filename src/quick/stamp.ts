/** Local time, to the minute, as a quick note's stamp: `2026-09-30 14:05`.
 *  From the window because the window knows the timezone and the core does not.
 *  Sortable as text, and the shape a daily note's heading already has. */
export function stampOf(now: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`
}
