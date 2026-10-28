// The app's own dictionaries, so selectors follow the copy: a renamed key fails loudly here
// instead of a selector silently matching nothing. Same {{x}} / One|Many rules as i18n.jsx.
import en from '../../../src/lib/i18n/en.js'
import fr from '../../../src/lib/i18n/fr.js'

function translate(dict, key, vars) {
  let node = dict
  for (const part of key.split('.')) node = node?.[part]
  if (typeof node !== 'string') throw new Error(`unknown i18n key: ${key}`)
  if (!vars) return node
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)), node)
}

export const t = (key, vars) => translate(en, key, vars)
export const tFr = (key, vars) => translate(fr, key, vars)
export const tc = (key, n, vars) => t(`${key}${n === 1 ? 'One' : 'Many'}`, { n, ...vars })
