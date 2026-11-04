import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { buildCachedBody, sendCachedBody, ifNoneMatchMatches } from '../walletApi.js'

const body = buildCachedBody({ hello: 'world' })
const app = express()
app.get('/x', (_req, res) => sendCachedBody(res, body, 300))

describe('sendCachedBody conditional GET', () => {
  it('no If-None-Match gives 200 with body', async () => {
    const r = await request(app).get('/x')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ hello: 'world' })
    expect(r.headers.etag).toBe(body.etag)
  })
  it('matching strong ETag gives 304 with ETag and Cache-Control', async () => {
    const r = await request(app).get('/x').set('If-None-Match', body.etag)
    expect(r.status).toBe(304)
    expect(r.text).toBe('')
    expect(r.headers.etag).toBe(body.etag)
    expect(r.headers['cache-control']).toBe('public, max-age=300')
  })
  it('matching weak W/ ETag (as nginx gzip sends it) gives 304', async () => {
    expect((await request(app).get('/x').set('If-None-Match', `W/${body.etag}`)).status).toBe(304)
  })
  it('matching with Cache-Control: no-cache (what fetch() sends) gives 304', async () => {
    const r = await request(app).get('/x').set('If-None-Match', `W/${body.etag}`)
      .set('Cache-Control', 'no-cache').set('Pragma', 'no-cache')
    expect(r.status).toBe(304)
  })
  it('comma list containing the ETag gives 304', async () => {
    expect((await request(app).get('/x').set('If-None-Match', `"aaa", W/"bbb" , ${body.etag}`)).status).toBe(304)
  })
  it('non-matching ETag gives 200 with body', async () => {
    const r = await request(app).get('/x').set('If-None-Match', '"0000"')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ hello: 'world' })
  })
  it('ifNoneMatchMatches handles * and empty', () => {
    expect(ifNoneMatchMatches('*', body.etag)).toBe(true)
    expect(ifNoneMatchMatches('', body.etag)).toBe(false)
    expect(ifNoneMatchMatches(undefined, body.etag)).toBe(false)
  })
})
