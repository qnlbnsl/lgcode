// Byte budgets count JSON encoding, including escaping, rather than characters.
export const boardLimits = {
  channelMembers: 64,
  postCharacters: 16_384,
  addressees: 16,
  wakeBytes: 256 * 1024,
  pageBytes: 512 * 1024,
  completionReplyIds: 17
} as const
