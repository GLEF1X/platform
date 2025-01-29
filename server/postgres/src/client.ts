import { concatLink } from '@hcengineering/core'
import type postgres from 'postgres'
import type { ParameterOrJSON } from 'postgres'
import { convertArrayParams, doFetchTypes, getPrepare } from './utils'

export type DBResult = any[] & { count: number }
export interface DBClient {
  execute: (query: string, parameters?: ParameterOrJSON<any>[] | undefined) => Promise<DBResult>

  release: () => void

  reserve: () => Promise<DBClient>

  raw: () => postgres.Sql
}

export function createDBClient (client: postgres.Sql, release: () => void = () => {}): DBClient {
  return {
    execute: (query, parameters) =>
      client.unsafe(query, doFetchTypes ? parameters : convertArrayParams(parameters), getPrepare()),
    release,
    reserve: async () => {
      const reserved = await client.reserve()
      return createDBClient(reserved, () => {
        reserved.release()
      })
    },
    raw: () => client
  }
}

class GreenClient implements DBClient {
  endpoint: string
  constructor (
    readonly url: string,
    private readonly token: string,
    private readonly connection: postgres.Sql,
    private readonly decoder: ((data: any) => Promise<any>) | undefined
  ) {
    this.endpoint = concatLink(url, '/api/v1/sql')
  }

  async execute (query: string, parameters?: ParameterOrJSON<any>[] | undefined): Promise<DBResult> {
    const params = convertArrayParams(parameters)
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.token
        },
        body: JSON.stringify({
          query,
          params
        })
      })
      if (!response.ok) {
        throw new Error(`Failed to execute sql: ${response.status} ${response.statusText}`)
      }
      if (this.decoder !== undefined) {
        return JSON.parse(await this.decoder(Buffer.from(await response.arrayBuffer())))
      }

      return await response.json()
    } catch (err: any) {
      console.warn('green failed', query)
      return await this.connection.unsafe(query, params, getPrepare())
    }
  }

  release (): void {}

  async reserve (): Promise<DBClient> {
    // We do reserve of connection, if we need it.
    return createGreenDBClient(this.url, this.token, await this.connection.reserve(), this.decoder)
  }

  raw (): postgres.Sql {
    return this.connection
  }
}

export function createGreenDBClient (
  url: string,
  token: string,
  connection: postgres.Sql,
  decoder?: (data: any) => Promise<any>
): DBClient {
  return new GreenClient(url, token, connection, decoder)
}
