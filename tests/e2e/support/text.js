// Small text helpers for accessible-name matching.
export const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Buttons whose accessible name is a label followed by more text (a description, a badge).
export const startsWith = label => new RegExp(`^${escapeRegExp(label)}`)
