// Bun embeds a .md file imported `with { type: 'text' }` as a string; this lets the type checker accept those imports.
declare module '*.md' {
  const text: string;
  export default text;
}
