/** Bir alanın sözlüğü: `tr`, `en` ile birebir aynı anahtarlara sahip olmalı. */
export function defineMessages<T extends Record<string, string>>(m: { en: T; tr: { [K in keyof T]: string } }) {
  return m;
}
