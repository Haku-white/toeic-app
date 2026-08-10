/** `--key value` 形式の引数を単純にパースする（CLIライブラリを導入するほどの規模ではないため自前実装）。 */
export function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        result[key] = next
        i += 1
      } else {
        result[key] = 'true'
      }
    }
  }
  return result
}
