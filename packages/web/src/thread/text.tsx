// Make directional and invisible formatting explicit. JSON also exposes tabs,
// line breaks and long whitespace in action input instead of hiding commands
// below apparently blank space. All output remains a React text child.
export const visibleText = (text: string) => text.replace(
  /[\p{Cc}\p{Cf}]/gu,
  (character) => /[\n\r\t]/u.test(character) ? character : escapeCharacter(character)
)
const escapeCharacter = (character: string) => {
  const point = character.codePointAt(0)!
  return point <= 0xffff ? `\\u${point.toString(16).padStart(4, "0")}` : `\\u{${point.toString(16)}}`
}
export const actionJson = (value: unknown) => visibleText(JSON.stringify(value) ?? "null")
  .replace(/[^\S ]/gu, escapeCharacter)
  .replace(/ {2,}/g, (spaces) => ` [${spaces.length} spaces] `)

export function DataText({ text }: { readonly text: string }) {
  return <pre className="agent-data" dir="ltr">{visibleText(text)}</pre>
}
