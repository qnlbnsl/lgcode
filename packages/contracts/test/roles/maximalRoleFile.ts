import { createHash } from "node:crypto";

// Valid JSON has at most two event-encoding bytes per input byte: JSON
// punctuation/backslashes and legal whitespace can double. Unescaped NULs
// would cost six, but cannot form an admitted document. Tabs approach the
// valid maximum while retaining escaped and multibyte advice.
export const maximalFile = {
  name: "界🙂", roles: { builder: { advice: '"\\\n\t界🙂'.repeat(20), limits: {} } },
};
const document = JSON.stringify(maximalFile);
export const maximalContent = document + "\t".repeat(65_536 - Buffer.byteLength(document));
export const maximalRoleFileEvent = {
  _tag: "roles.RoleFileSet" as const, content: maximalContent,
  roleFileHash: createHash("sha256").update(maximalContent).digest("hex"),
};
