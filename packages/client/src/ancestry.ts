import { readFileSync } from "node:fs"
import { ClientError } from "./errors.ts"

// Fields of `/proc/<pid>/stat` after the closing parenthesis of the command
// name, so a name that holds spaces or parentheses cannot shift them.
const statFields = (pid: number): Array<string> => {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8")
  return text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/)
}

// Row 64's handshake headers: `pid:start time` pairs from this process up
// through each parent until one cannot be read, and this process's group.
// Version 1 runs on Linux only (owner, 2026-11-01); any other platform is
// refused before /proc is read. The platform is an argument so a test can pass
// another one.
export const ancestryHeaders = (
  pid: number = process.pid, platform: NodeJS.Platform = process.platform
): Record<string, string> => {
  if (platform !== "linux") {
    throw new ClientError({ message: "the process ancestry check runs on Linux only in this version" })
  }
  const chain: Array<string> = []
  let group: string
  try {
    group = statFields(pid)[2]!
    let current = pid
    for (let depth = 0; depth < 64 && current > 0; depth++) {
      let fields: Array<string>
      try { fields = statFields(current) } catch { break }
      chain.push(`${current}:${fields[19]}`)
      current = Number(fields[1])
    }
  } catch {
    throw new ClientError({ message: "the process ancestry cannot be read from /proc" })
  }
  return { "Sheprd-Ancestors": chain.join(","), "Sheprd-Process-Group": group }
}
