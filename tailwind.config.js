/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Display face for the wordmark/titles — Fraunces, the closest free match to
        // Altered Core's commercial title font ("Tiller").
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        // Faction identity colours (theme-independent).
        ax: '#894b33',  // Axiom — brown/orange
        br: '#9e3c40',  // Bravos — dark red
        ly: '#d89da3',  // Lyra — pink/rose
        mu: '#3f9085',  // Muna — teal
        or: '#00628e',  // Ordis — blue
        yz: '#6d4f95',  // Yzmir — purple

        // Semantic theme tokens — backed by CSS vars so one set of classes serves
        // both light & dark (see src/index.css). Channels are space-separated RGB so
        // Tailwind's /<alpha> modifier works (e.g. bg-accent/10).
        base:        'rgb(var(--c-base) / <alpha-value>)',       // page background
        surface:     'rgb(var(--c-surface) / <alpha-value>)',    // panels/cards
        surface2:    'rgb(var(--c-surface2) / <alpha-value>)',   // inputs / secondary buttons
        surface3:    'rgb(var(--c-surface3) / <alpha-value>)',   // hover / raised
        ink:         'rgb(var(--c-ink) / <alpha-value>)',        // primary text
        ink2:        'rgb(var(--c-ink2) / <alpha-value>)',       // secondary text
        muted:       'rgb(var(--c-muted) / <alpha-value>)',      // muted text
        faint:       'rgb(var(--c-faint) / <alpha-value>)',      // faint text/labels
        line:        'rgb(var(--c-line) / <alpha-value>)',       // borders/dividers
        accent:      'rgb(var(--c-accent) / <alpha-value>)',     // gold accent
        accent2:     'rgb(var(--c-accent2) / <alpha-value>)',    // gold hover/bright
        'on-accent': 'rgb(var(--c-on-accent) / <alpha-value>)',  // text on gold
        'accent-ink': 'rgb(var(--c-accent-ink) / <alpha-value>)', // gold as text (readable on light)
        ok:          'rgb(var(--c-ok) / <alpha-value>)',         // success text / borders
        'ok-soft':   'rgb(var(--c-ok-soft) / <alpha-value>)',    // success pill / panel bg
        danger:      'rgb(var(--c-danger) / <alpha-value>)',     // error text / borders
        'danger-soft': 'rgb(var(--c-danger-soft) / <alpha-value>)', // error pill / panel bg
      },
    },
  },
  plugins: [],
}
