// Local Quartz plugin: marks navigation links as "hiero" and stores their
// text as latin (data-latin) and as egyptian hieroglyphs (data-glyph).
// custom.scss swaps data-glyph -> data-latin on hover.

const GLYPHS = {
  A: "\u{13133}",
  B: "\u{13080}",
  C: "\u{130A1}",
  D: "\u{130A7}",
  E: "\u{130ED}",
  F: "\u{130C1}",
  G: "\u{130BC}",
  H: "\u{1308D}",
  I: "\u{130F2}",
  J: "\u{130C3}",
  K: "\u{13216}",
  L: "\u{130CD}",
  M: "\u{13153}",
  N: "\u{13217}",
  O: "\u{13171}",
  P: "\u{132AA}",
  Q: "\u{13091}",
  R: "\u{13291}",
  S: "\u{130CF}",
  T: "\u{13297}",
  U: "\u{1340B}",
  V: "\u{13089}",
  W: "\u{130DE}",
  X: "\u{13296}",
  Y: "\u{130F3}",
  Z: "\u{13371}",
}

const script = `
const GLYPHS = ${JSON.stringify(GLYPHS)}
const SELECTOR = ".explorer a, .section-li a.internal-link, .breadcrumbs a, a.tag-link, .backlinks a, article a.internal"
function toGlyphs(text) {
  return [...text].map((ch) => GLYPHS[ch.toUpperCase()] ?? ch).join("")
}
function decorate(root) {
  root.querySelectorAll(SELECTOR).forEach((a) => {
    if (a.querySelector("svg, img, code")) return
    const latin = a.textContent
    if (!latin || !latin.trim()) return
    a.dataset.latin = latin
    a.dataset.glyph = toGlyphs(latin)
    a.classList.add("hiero")
  })
}
function reset(root) {
  root.querySelectorAll("a.hiero").forEach((a) => {
    a.classList.remove("hiero")
    delete a.dataset.glyph
    delete a.dataset.latin
  })
}
document.addEventListener("nav", () => {
  reset(document)
  decorate(document)
})
decorate(document)
`

const Hieroglyphs = () => ({
  name: "Hieroglyphs",
  textTransform: (_ctx, src) => src,
  externalResources: () => ({
    js: [
      {
        loadTime: "afterDOMReady",
        contentType: "inline",
        script,
        spaPreserve: true,
      },
    ],
  }),
})

export default Hieroglyphs
