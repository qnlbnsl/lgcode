// Engine identifiers may contain punctuation and whitespace. Encode those
// identifiers before composing a redaction-exempt key. Reserving the prefix
// prevents an encoded identifier from colliding with a literal identifier.
export const alertKeyPart = (id: string): string =>
  /^[A-Za-z0-9_-]+$/.test(id) && !id.startsWith("id_") ? id : `id_${Buffer.from(id, "utf16le").toString("hex")}`;
