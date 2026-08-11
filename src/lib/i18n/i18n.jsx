import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import en from './en.js'
import fr from './fr.js'

// UI-copy language (EN/FR), independent of the per-room card-text `config.lang` (which
// governs card names/effects, fetched from the card DB — see cardData.js). Persisted in
// localStorage so it survives refresh, mirroring theme.js's pattern.
const DICTS = { en, fr }
const KEY = 'ui_lang'
const LangContext = createContext(null)

function readStored() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'fr' ? 'fr' : v === 'en' ? 'en' : null
  } catch { return null }
}

function detectDefault() {
  try {
    return (navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en'
  } catch { return 'en' }
}

function lookup(dict, path) {
  let node = dict
  for (const p of path) node = node?.[p]
  return node
}

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => readStored() ?? detectDefault())

  const setLang = useCallback(next => {
    const l = next === 'fr' ? 'fr' : 'en'
    setLangState(l)
    try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
  }, [])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  // key: dotted path, e.g. "topNav.help". vars: {{name}} placeholders substituted in.
  const t = useCallback((key, vars) => {
    const path = key.split('.')
    const value = lookup(DICTS[lang], path) ?? lookup(DICTS.en, path) ?? key
    if (!vars) return value
    return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)), value)
  }, [lang])

  // Plural helper: looks up `${key}One` for n===1, `${key}Many` otherwise, with {{n}} (and
  // any extra vars) substituted — two explicit strings per count instead of a generic
  // pluralization engine, since French/English don't always pluralize the same words
  // (e.g. "1 héros"/"3 héros" is invariant where English adds "es").
  const tc = useCallback((key, n, vars) => t(`${key}${n === 1 ? 'One' : 'Many'}`, { n, ...vars }), [t])

  return (
    <LangContext.Provider value={{ lang, setLang, t, tc }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext) ?? { lang: 'en', setLang: () => {}, t: key => key, tc: key => key }
}