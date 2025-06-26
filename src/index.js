// src/index.js - Debug version for Railway
import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

// Health check endpoint
app.get('/health', (c) => {
  console.log('Health check called')
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: process.env.PORT || '3000',
    host: '0.0.0.0'
  })
})

// Root endpoint
app.get('/', (c) => {
  return c.html(`
    <html>
      <head><title>Hono Tunnelmole</title></head>
      <body>
        <h1>🚇 Hono Tunnelmole</h1>
        <p>Server is running!</p>
        <p>Port: ${process.env.PORT || '3000'}</p>
        <p>Time: ${new Date().toISOString()}</p>
        <a href="/health">Health Check</a>
      </body>
    </html>
  `)
})

// Test API endpoint
app.get('/api/test', (c) => {
  return c.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  })
})

// Catch all
app.all('*', (c) => {
  return c.json({
    error: 'Not found',
    path: c.req.url,
    method: c.req.method
  }, 404)
})

// Start server
const port = parseInt(process.env.PORT || '3000')
const host = '0.0.0.0'

console.log('🚀 Starting server...')
console.log(`📡 Port: ${port}`)
console.log(`🖥️  Host: ${host}`)
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`)

serve({
  fetch: app.fetch,
  port: port,
  hostname: host
}, (info) => {
  console.log(`✅ Server running at http://${info.address}:${info.port}`)
  console.log(`🏥 Health check: http://${info.address}:${info.port}/health`)
})

export default app
