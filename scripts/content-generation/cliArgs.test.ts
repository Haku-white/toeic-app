import { describe, expect, it } from 'vitest'
import { parseArgs } from './cliArgs'

describe('parseArgs', () => {
  it('parses --key value pairs', () => {
    expect(parseArgs(['--category', 'tense', '--count', '5'])).toEqual({ category: 'tense', count: '5' })
  })

  it('treats a flag with no following value (or followed by another flag) as "true"', () => {
    expect(parseArgs(['--dry-run', '--category', 'tense'])).toEqual({ 'dry-run': 'true', category: 'tense' })
  })

  it('ignores bare positional arguments', () => {
    expect(parseArgs(['positional', '--count', '3'])).toEqual({ count: '3' })
  })

  it('returns an empty object for no arguments', () => {
    expect(parseArgs([])).toEqual({})
  })
})
