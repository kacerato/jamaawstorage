import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error Local serverless handler has no TS types.
import kimiStockImportHandler from './api/kimi-stock-import.js'

function localKimiApiPlugin() {
  return {
    name: 'local-kimi-api',
    configureServer(server: {
      middlewares: {
        use: (path: string, handler: (req: NodeJS.ReadableStream & { method?: string; body?: string }, res: NodeJS.WritableStream & {
          setHeader: (name: string, value: string) => void
          end: (chunk?: string) => void
          statusCode?: number
        }, next: (error?: unknown) => void) => void) => void
      }
    }) {
      server.middlewares.use('/api/kimi-stock-import', (req, res, next) => {
        const response = res as NodeJS.WritableStream & {
          setHeader: (name: string, value: string) => void
          end: (chunk?: string) => void
          statusCode?: number
        } & {
          status?: (code: number) => typeof response
          json?: (payload: unknown) => void
        }

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
            await kimiStockImportHandler(
              Object.assign(req, { body }) as Parameters<typeof kimiStockImportHandler>[0],
              response as Parameters<typeof kimiStockImportHandler>[1],
            )
          } catch (error) {
            next(error)
          }
        })
        req.on('error', next)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.KIMI_API) {
    process.env.KIMI_API = env.KIMI_API
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      localKimiApiPlugin(),
    ],
  }
})
