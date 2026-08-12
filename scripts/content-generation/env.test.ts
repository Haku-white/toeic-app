import { afterEach, describe, expect, it, vi } from 'vitest'

// 実際の.envファイルやdotenvのバージョン差異に依存しないよう、config()を no-op にする
// （process.envは各テストで直接設定する）。
vi.mock('dotenv', () => ({ config: vi.fn() }))

const ORIGINAL_ENV = { ...process.env }

async function freshLoadEnv() {
  vi.resetModules()
  const mod = await import('./env')
  return mod.loadEnv
}

describe('loadEnv', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('throws a readable error when required keys are missing', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const loadEnv = await freshLoadEnv()
    expect(() => loadEnv()).toThrow('SUPABASE_URL')
  })

  it('returns values from process.env, defaulting GEMINI_MODEL when unset', async () => {
    process.env.SUPABASE_URL = 'https://qpfmssdhbtlbudqburki.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test'
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_MODEL
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const loadEnv = await freshLoadEnv()
    const env = loadEnv()

    expect(env).toEqual({
      SUPABASE_URL: 'https://qpfmssdhbtlbudqburki.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
      GEMINI_API_KEY: undefined,
      GEMINI_MODEL: 'gemini-2.5-flash',
    })
  })

  describe('23.5: 接続先ログ・警告（想定外の接続先の見落とし対策）', () => {
    it('logs a plain confirmation (no warning) when SUPABASE_URL matches the known cloud project', async () => {
      process.env.SUPABASE_URL = 'https://qpfmssdhbtlbudqburki.supabase.co'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test'
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const loadEnv = await freshLoadEnv()
      loadEnv()

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('クラウド'))
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('warns when SUPABASE_URL points to localhost', async () => {
      process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_local'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const loadEnv = await freshLoadEnv()
      loadEnv()

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ローカル'))
    })

    it('warns when SUPABASE_URL is neither the known cloud project nor localhost', async () => {
      process.env.SUPABASE_URL = 'https://some-other-project.supabase.co'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_other'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const loadEnv = await freshLoadEnv()
      loadEnv()

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('想定外'))
    })

    it('only logs the connection target once even when loadEnv is called multiple times in the same process', async () => {
      process.env.SUPABASE_URL = 'https://qpfmssdhbtlbudqburki.supabase.co'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test'
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const loadEnv = await freshLoadEnv()
      loadEnv()
      loadEnv()
      loadEnv()

      expect(logSpy).toHaveBeenCalledTimes(1)
    })
  })
})
