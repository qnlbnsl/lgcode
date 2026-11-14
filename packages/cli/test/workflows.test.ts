import { expect, test } from 'vitest'
import { commandNames, matchCommand, helpText } from '../src/commands/registry.ts'
import { parseArguments } from '../src/commands/parse.ts'
import { commandAccess } from '@lgtm/contracts'
for (const action of ['list', 'read', 'clone', 'save', 'validate', 'delete'] as const) test(`workflow ${action} has a typed owner CLI request`, () => {
  const command = `client.workflows.${action}` as const
  expect(commandNames).toContain(command)
  expect(matchCommand(['client', 'workflows', action, '--input', '{}'])).toEqual({ command, rest: ['--input', '{}'] })
  expect(helpText(command)).toContain(`Usage: lgtm client workflows ${action}`)
  expect(commandAccess[command]).toEqual(['owner'])
  expect(parseArguments(command, ['--input', '{"id":"copy","scope":"user"}']).payload).toMatchObject({ id: 'copy', scope: 'user' })
})
