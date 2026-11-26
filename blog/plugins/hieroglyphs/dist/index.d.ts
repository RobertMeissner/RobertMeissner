declare const Hieroglyphs: () => {
  name: string
  textTransform: (ctx: unknown, src: string) => string
  externalResources: () => object
}
export default Hieroglyphs
