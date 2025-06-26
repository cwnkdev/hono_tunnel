// src/index.js - Simplified working version for Railway
import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

// Simple in-memory storage
const tunnels = new Map()

function generateId() {
  return Math.random().toString(36).substring(2, 8)
}

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: process.env.PORT || '3000',
    activeTunnels: tunnels.size
  })
})

// Simple dashboard
app.get('/', (c) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>🚇 Tunnelmole</title>
    <style>
        body { font-family: Arial; margin: 40px; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        .status { background: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0; }
        .tunnel { background: #fff3cd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .code { background: #f8f9fa; padding: 8px; border-radius: 3px; font-family: monospace; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚇 Tunnelmole</h1>
        
        <div class="status">
            <h3>✅ Server Online</h3>
            <p>Active Tunnels: ${tunnels.size}</p>
        </div>

        <h3>🌐 Active Tunnels</h3>
        ${Array.from(tunnels.values()).map(tunnel => `
            <div class="tunnel">
                <strong>ID:</strong> ${tunnel.id}<br>
                <strong>Port:</strong> ${tunnel.localPort}<br>
                <strong>URL:</strong> <a href="/t/${tunnel.id}/" target="_blank">/t/${tunnel.id}/</a>
            </div>
        `).join('') || '<p>No active tunnels</p>'}

        <h3>📚 Usage</h3>
        <p>1. Create tunnel:</p>
        <div class="code">curl -X POST ${new URL(c.req.url).origin}/api/tunnel/create -H "Content-Type: application/json" -d '{"localPort": 3000}'</div>
        
        <p>2. Use public URL:</p>
        <div class="code">${new URL(c.req.url).origin}/t/TUNNEL_ID/</div>
    </div>
</body>
</html>`
  
  return c.html(html)
})

// Create tunnel API
app.post('/api/tunnel/create', async (c) => {
  try {
    const body = await c.req.json()
    const { localPort, subdomain } = body

    if (!localPort) {
      return c.json({ error: 'Local port is required' }, 400)
    }

    const id = subdomain || generateId()
    
    if (tunnels.has(id)) {
      return c.json({ error: 'Tunnel ID already exists' }, 409)
    }

    const tunnel = {
      id,
      localPort,
      createdAt: new Date(),
      requestCount: 0,
      connected: false
    }

    tunnels.set(id, tunnel)
    
    const baseUrl = new URL(c.req.url).origin
    const publicUrl = `${baseUrl}/t/${id}`
    const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/${id}`

    console.log(`✅ Tunnel created: ${id} -> localhost:${localPort}`)

    return c.json({
      success: true,
      tunnel: {
        id: tunnel.id,
        publicUrl,
        wsUrl,
        localPort: tunnel.localPort,
        createdAt: tunnel.createdAt
      }
    })
  } catch (error) {
    console.error('Create tunnel error:', error)
    return c.json({ error: 'Failed to create tunnel' }, 500)
  }
})

// List tunnels
app.get('/api/tunnels', (c) => {
  const tunnelList = Array.from(tunnels.values())
  return c.json({ tunnels: tunnelList })
})

// Get tunnel info
app.get('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  const tunnel = tunnels.get(id)
  
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  return c.json(tunnel)
})

// Delete tunnel
app.delete('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  
  if (tunnels.has(id)) {
    tunnels.delete(id)
    console.log(`🗑️ Tunnel deleted: ${id}`)
    return c.json({ success: true, message: 'Tunnel deleted' })
  } else {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
})

// Simple proxy endpoint - just return connection info for now
app.all('/t/:id/*', async (c) => {
  const tunnelId = c.req.param('id')
  const path = c.req.param('*') || ''
  
  const tunnel = tunnels.get(tunnelId)
  if (!tunnel) {
    return c.html(`
      <html>
        <head><title>Tunnel Not Found</title></head>
        <body style="font-family: Arial; text-align: center; margin-top: 100px;">
          <h1>❌ Tunnel Not Found</h1>
          <p>Tunnel ID: <code>${tunnelId}</code></p>
          <a href="/">← Back to Dashboard</a>
        </body>
      </html>
    `, 404)
  }
  
  // Update stats
  tunnel.requestCount++
  
  // For now, return a simple response indicating tunnel is working
  return c.html(`
    <html>
      <head><title>Tunnel Working</title></head>
      <body style="font-family: Arial; text-align: center; margin-top: 50px;">
        <h1>🚇 Tunnel is Working!</h1>
        <p><strong>Tunnel ID:</strong> ${tunnelId}</p>
        <p><strong>Path:</strong> /${path}</p>
        <p><strong>Local Port:</strong> ${tunnel.localPort}</p>
        <p><strong>Request Count:</strong> ${tunnel.requestCount}</p>
        <p><strong>Method:</strong> ${c.req.method}</p>
        
        <div style="background: #f8f9fa; padding: 20px; margin: 20px; border-radius: 8px;">
          <h3>📋 Request Details</h3>
          <p><strong>URL:</strong> ${c.req.url}</p>
          <p><strong>Headers:</strong></p>
          <pre style="text-align: left; background: white; padding: 10px; border-radius: 4px;">${JSON.stringify(Object.fromEntries(Object.entries(c.req.header())), null, 2)}</pre>
        </div>
        
        <div style="background: #d1ecf1; padding: 15px; margin: 20px; border-radius: 8px;">
          <h3>🔧 To connect your local app:</h3>
          <p>1. Run your app on port ${tunnel.localPort}</p>
          <p>2. Use the tunnel client to connect</p>
          <p>3. This page will then show your actual app</p>
        </div>
        
        <a href="/">← Back to Dashboard</a>
      </body>
    </html>
  `)
})

// API test endpoint
app.get('/api/test', (c) => {
  return c.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    tunnels: tunnels.size
  })
})

// 404 handler
app.notFound((c) => {
  return c.json({ 
    error: 'Not found',
    path: c.req.url,
    method: c.req.method
  }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

// Start server
const port = parseInt(process.env.PORT || '3000')
const host = '0.0.0.0'

console.log('🚀 Starting Tunnelmole server...')
console.log(`📡 Port: ${port}`)
console.log(`🖥️ Host: ${host}`)

try {
  serve({
    fetch: app.fetch,
    port: port,
    hostname: host
  }, (info) => {
    console.log(`✅ Server running at http://${info.address}:${info.port}`)
    console.log(`🏥 Health check: http://${info.address}:${info.port}/health`)
    console.log(`📊 Dashboard: http://${info.address}:${info.port}`)
  })
} catch (error) {
  console.error('❌ Failed to start server:', error)
  process.exit(1)
}

export default app
