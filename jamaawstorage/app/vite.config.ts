import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error Local serverless handler has no TS types.
import kimiStockImportHandler from './api/kimi-stock-import.js'
// @ts-expect-error Local serverless handler has no TS types.
import telegramWithdrawalNotifyHandler from './api/telegram-withdrawal-notify.js'
// @ts-expect-error Local serverless handler has no TS types.
import vehicleImageAnalysisHandler from './api/vehicle-image-analysis.js'
// @ts-expect-error Local serverless handler has no TS types.
import kimiAssistantHandler from './api/kimi-assistant.js'

type LocalApiRequest = NodeJS.ReadableStream & { method?: string; body?: string }
type LocalApiResponse = NodeJS.WritableStream & {
  setHeader: (name: string, value: string) => void
  end: (chunk?: string) => void
  statusCode?: number
} & {
  status?: (code: number) => LocalApiResponse
  json?: (payload: unknown) => void
}

function attachLocalApiHandler(
  server: {
    middlewares: {
      use: (
        path: string,
        handler: (
          req: LocalApiRequest,
          res: LocalApiResponse,
          next: (error?: unknown) => void,
        ) => void,
      ) => void
    }
  },
  path: string,
  handler: (req: LocalApiRequest, res: LocalApiResponse) => Promise<void>,
) {
  server.middlewares.use(path, (req, res, next) => {
    const response = res as LocalApiResponse

    response.status = (code: number) => {
      response.statusCode = code
      return response
    }
    response.json = (payload: unknown) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(payload))
    }

    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', async () => {
      try {
        await handler(
          Object.assign(req, { body }) as LocalApiRequest,
          response,
        )
      } catch (error) {
        next(error)
      }
    })
    req.on('error', next)
  })
}

function localApiPlugin() {
  return {
    name: 'local-api-handlers',
    configureServer(server: {
      middlewares: {
        use: (
          path: string,
          handler: (req: LocalApiRequest, res: LocalApiResponse, next: (error?: unknown) => void) => void,
        ) => void
      }
    }) {
      attachLocalApiHandler(server, '/api/kimi-stock-import', async (req, res) => {
        await kimiStockImportHandler(
          req as Parameters<typeof kimiStockImportHandler>[0],
          res as Parameters<typeof kimiStockImportHandler>[1],
        )
      })
      attachLocalApiHandler(server, '/api/telegram-withdrawal-notify', async (req, res) => {
        await telegramWithdrawalNotifyHandler(
          req as Parameters<typeof telegramWithdrawalNotifyHandler>[0],
          res as Parameters<typeof telegramWithdrawalNotifyHandler>[1],
        )
      })
      attachLocalApiHandler(server, '/api/vehicle-image-analysis', async (req, res) => {
        await vehicleImageAnalysisHandler(
          req as Parameters<typeof vehicleImageAnalysisHandler>[0],
          res as Parameters<typeof vehicleImageAnalysisHandler>[1],
        )
      })
      attachLocalApiHandler(server, '/api/kimi-assistant', async (req, res) => {
        await kimiAssistantHandler(
          req as Parameters<typeof kimiAssistantHandler>[0],
          res as Parameters<typeof kimiAssistantHandler>[1],
        )
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const forwardedEnvKeys = [
    'KIMI_API',
    'KIMI_CHAT_MODEL',
    'KIMI_REASONING_EFFORT',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'TELEGRAM_CHANNEL_URL',
    'ZAI_API_KEY',
  ] as const

  for (const key of forwardedEnvKeys) {
    if (env[key]) {
      process.env[key] = env[key]
    }
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      localApiPlugin(),
    ],
  }
})
