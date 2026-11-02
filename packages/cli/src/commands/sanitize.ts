// Agent-written text reaches a person's terminal through this tool, so it is
// stripped of everything a terminal would act on (row 62's output rule):
// C0 controls other than newline and tab, DEL, C1 controls, and the escape
// sequences that carry a payload, payload included.

const ESC = "\u001b"
// OSC, DCS, SOS, PM and APC strings end at BEL or ST (ESC \). An unterminated
// one is dropped through the end of its line, as a terminal would swallow it.
const escapeStrings = new RegExp(
  `${ESC}[\\]PX^_][^\\u0007${ESC}\\n]*(?:\\u0007|${ESC}\\\\|(?=${ESC})|$|\\n)`, "gm"
)
const c1OperatingSystemCommand = /\u009d[^\u0007\u009c\u001b]*(?:\u0007|\u009c|\u001b\\)/g
const csi = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g
// Any other two-character escape sequence, such as ESC c or ESC ( B.
const shortEscape = /\u001b[ -/]*[0-~]?/g
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

export const sanitize = (text: string): string =>
  text.replace(escapeStrings, "").replace(c1OperatingSystemCommand, "").replace(csi, "").replace(shortEscape, "").replace(controls, "")

// Every string in a value, for output that is JSON.
export const sanitizeJson = (value: unknown, space?: number): string =>
  JSON.stringify(value, (_key, entry) => typeof entry === "string" ? sanitize(entry) : entry, space)
