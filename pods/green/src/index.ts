import { postgres, type SQL } from 'bun'
import { compress } from 'snappy'

const port = process.env.PORT ?? 6767
const version = process.env.VERSION ?? '0.6.388'
const dbUrl = process.env.DB_URL ?? 'postgresql://root@host.docker.internal:26257/defaultdb?sslmode=disable'
const extraOptions = JSON.parse(process.env.DB_OPTIONS ?? '{}')

const authToken = process.env.AUTH_TOKEN ?? 'secret'
const tickTimeout = 5000

console.log('Green service: v4 ' + version, ' on port ' + port)

const sql: SQL = new postgres(dbUrl, {
  ...extraOptions
})

async function toResponse(url: URL, data: any): Promise<Response> {
  if (url.searchParams.get('compress') === 'snappy') {
    return new Response(await compress(JSON.stringify(data)), {
      headers: {
        'Content-Type': 'application/json',
        compress: 'snappy'
      }
    })
  }
  return Response.json(data)
}

let activeQueries = new Map<number, { time: number; cancel: () => void; query: string }>()

setInterval(() => {
  for (const [k, v] of activeQueries.entries()) {
    if (Date.now() - v.time > tickTimeout) {
      console.log('query hang', k, v)
      v.cancel()
      activeQueries.delete(k)
    }
  }
}, tickTimeout)

let queryId = 0

async function handleSQLFind(url: URL, req: Request): Promise<Response> {
  const json = await req.json()
  const qid = ++queryId
  try {
    const lq = json.query.toLowerCase()
    if( lq.includes('begin') || lq.includes('commit') || lq.includes('rollback')) {
      console.error('not allowed', json.query)
      return new Response('Not allowed', { status: 403 })
    }
    const st = Date.now()
    const query = sql(json.query, ...(json.params ?? []))
    activeQueries.set(qid, { time: Date.now(), cancel: () => query.cancel(), query: json.query })
    const result = await query
    console.log('query', json.query, Date.now() - st, result.length)    
    return await toResponse(url, result)
  } catch (err: any) {
    console.error('failed to execute sql', json.query, json.params, err.message, err)
    return new Response(err.message, { status: 500 })
  } finally {
    activeQueries.delete(qid)
  }
}

Bun.serve({
  async fetch(req: Request) {
    const token = (req.headers.get('Authorization') ?? '').split(' ')[1]
    if (token !== authToken) {
      return new Response('Unauthorized', { status: 401 })
    }

    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/v1/version')) {
      return new Response(version)
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/v1/sql')) {
      return await handleSQLFind(url, req)
    }

    return new Response('Success!')
  },
  port
})
