// Stands in for public/altered-card-renderer.min.js (vendored, hardcodes alteredcore.org
// hosts, would stall ~20 s per unique offline). Defines <altered-card> and the
// window.AlteredRender API that renderUniqueFace (src/lib/uniqueFaces.js) calls:
// mountFromApi(host, card) paints a busy canvas (toDataURL('image/jpeg', 0.85) > 8000 chars)
// inside host and resolves { canvas, state } with the art loaded (state.images.bg).
export const RENDERER_STUB = `
(() => {
  if (customElements.get('altered-card')) return
  function paint(ref) {
    const canvas = document.createElement('canvas')
    canvas.width = 744
    canvas.height = 1039
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 744, 1039)
    gradient.addColorStop(0, '#24323f')
    gradient.addColorStop(1, '#c9a24a')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 744, 1039)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
    for (let x = -1039; x < 744; x += 16) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + 8, 0)
      ctx.lineTo(x + 8 + 1039, 1039)
      ctx.lineTo(x + 1039, 1039)
      ctx.fill()
    }
    ctx.fillStyle = '#ffffff'
    ctx.font = '48px sans-serif'
    ctx.fillText(ref || 'unique', 24, 520)
    return canvas
  }
  window.AlteredRender = {
    init: async () => ({}),
    mountFromApi: async (host, card) => {
      const canvas = paint(card.reference)
      host.innerHTML = ''
      host.appendChild(canvas)
      return { canvas, state: { images: { bg: {} } } }
    },
  }
  class AlteredCardStub extends HTMLElement {
    connectedCallback() {
      if (this.querySelector('canvas')) return
      this.appendChild(paint(this.getAttribute('ref')))
    }
  }
  customElements.define('altered-card', AlteredCardStub)
})()
`
