// src/index.js - HTTP Polling Proxy without WebSocket
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import http from 'http'

const app = new Hono()

// Storage for tunnels and their target hosts
const tunnels = new Map()
const targetHosts = new Map() // tunnelId -> { host, port }

function generateId() {
  return Math.random().toString(36).substring(2, 8)
}

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: process.env.PORT || '3000',
    activeTunnels: tunnels.size,
    registeredHosts: targetHosts.size
  })
})

// Dashboard
app.get('/', (c) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>🚇 HTTP Polling Tunnelmole</title>
    <style>
        body { font-family: Arial; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        .status { background: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0; }
        .tunnel { background: #fff3cd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .code { background: #f8f9fa; padding: 8px; border-radius: 3px; font-family: monospace; }
        .connected { color: #28a745; }
        .disconnected { color: #dc3545; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚇 HTTP Polling Tunnelmole</h1>
        
        <div class="status">
            <h3>✅ Server Online</h3>
            <p>Active Tunnels: ${tunnels.size}</p>
            <p>Registered Hosts: ${targetHosts.size}</p>
        </div>

        <h3>🌐 Active Tunnels</h3>
        ${Array.from(tunnels.values()).map(tunnel => {
          const isRegistered = targetHosts.has(tunnel.id)
          return `
            <div class="tunnel">
                <strong>ID:</strong> ${tunnel.id}<br>
                <strong>Port:</strong> ${tunnel.localPort}<br>
                <strong>URL:</strong> <a href="/t/${tunnel.id}/" target="_blank">/t/${tunnel.id}/</a><br>
                <strong>Status:</strong> <span class="${isRegistered ? 'connected' : 'disconnected'}">${isRegistered ? 'Host Registered' : 'Waiting for Registration'}</span><br>
                <strong>Requests:</strong> ${tunnel.requestCount}
            </div>
          `
        }).join('') || '<p>No active tunnels</p>'}

        <h3>📚 Usage Instructions</h3>
        <p><strong>Step 1:</strong> Create tunnel</p>
        <div class="code">curl -X POST ${new URL(c.req.url).origin}/api/tunnel/create -H "Content-Type: application/json" -d '{"localPort": 3000}'</div>
        
        <p><strong>Step 2:</strong> Register your local host</p>
        <div class="code">curl -X POST ${new URL(c.req.url).origin}/api/register/TUNNEL_ID -H "Content-Type: application/json" -d '{"host": "localhost", "port": 3000}'</div>
        
        <p><strong>Step 3:</strong> Access via public URL</p>
        <div class="code">${new URL(c.req.url).origin}/t/TUNNEL_ID/</div>
        
        <p><strong>Auto Registration Script:</strong></p>
        <div class="code">
# Create tunnel and register in one go<br>
TUNNEL_ID=$(curl -s -X POST ${new URL(c.req.url).origin}/api/tunnel/create -H "Content-Type: application/json" -d '{"localPort": 3000}' | jq -r '.tunnel.id')<br>
curl -X POST ${new URL(c.req.url).origin}/api/register/$TUNNEL_ID -H "Content-Type: application/json" -d '{"host": "YOUR_LOCAL_IP", "port": 3000}'<br>
echo "Public URL: ${new URL(c.req.url).origin}/t/$TUNNEL_ID/"
        </div>
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
      requestCount: 0
    }

    tunnels.set(id, tunnel)
    
    const baseUrl = new URL(c.req.url).origin
    const publicUrl = `${baseUrl}/t/${id}`

    console.log(`✅ Tunnel created: ${id} -> localhost:${localPort}`)

    return c.json({
      success: true,
      tunnel: {
        id: tunnel.id,
        publicUrl,
        localPort: tunnel.localPort,
        createdAt: tunnel.createdAt,
        registrationUrl: `${baseUrl}/api/register/${id}`
      }
    })
  } catch (error) {
    console.error('Create tunnel error:', error)
    return c.json({ error: 'Failed to create tunnel' }, 500)
  }
})

// Register target host for tunnel
app.post('/api/register/:id', async (c) => {
  try {
    const tunnelId = c.req.param('id')
    const body = await c.req.json()
    const { host, port } = body

    if (!host || !port) {
      return c.json({ error: 'Host and port are required' }, 400)
    }

    const tunnel = tunnels.get(tunnelId)
    if (!tunnel) {
      return c.json({ error: 'Tunnel not found' }, 404)
    }

    // Store target host info
    targetHosts.set(tunnelId, { host, port: parseInt(port) })
    
    console.log(`📡 Registered target: ${tunnelId} -> ${host}:${port}`)

    return c.json({
      success: true,
      message: 'Target host registered',
      tunnelId,
      target: { host, port }
    })
  } catch (error) {
    console.error('Register error:', error)
    return c.json({ error: 'Failed to register target' }, 500)
  }
})

// List tunnels
app.get('/api/tunnels', (c) => {
  const tunnelList = Array.from(tunnels.values()).map(tunnel => ({
    ...tunnel,
    registered: targetHosts.has(tunnel.id),
    target: targetHosts.get(tunnel.id)
  }))
  return c.json({ tunnels: tunnelList })
})

// Get tunnel info
app.get('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  const tunnel = tunnels.get(id)
  
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  return c.json({
    ...tunnel,
    registered: targetHosts.has(id),
    target: targetHosts.get(id)
  })
})

// Delete tunnel
app.delete('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  
  if (tunnels.has(id)) {
    tunnels.delete(id)
    targetHosts.delete(id)
    console.log(`🗑️ Tunnel deleted: ${id}`)
    return c.json({ success: true, message: 'Tunnel deleted' })
  } else {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
})

// HTTP Proxy - Forward requests to registered target
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
  
  const target = targetHosts.get(tunnelId)
  if (!target) {
    return c.html(`
      <html>
        <head><title>Target Not Registered</title></head>
        <body style="font-family: Arial; text-align: center; margin-top: 100px;">
          <h1>🔗 Target Not Registered</h1>
          <p>Tunnel ID: <code>${tunnelId}</code></p>
          <p>Please register your target host first:</p>
          <code style="background: #f5f5f5; padding: 10px; display: block; margin: 20px;">
            curl -X POST ${new URL(c.req.url).origin}/api/register/${tunnelId} \\<br>
            &nbsp;&nbsp;-H "Content-Type: application/json" \\<br>
            &nbsp;&nbsp;-d '{"host": "YOUR_LOCAL_IP", "port": ${tunnel.localPort}}'
          </code>
          <a href="/">← Back to Dashboard</a>
        </body>
      </html>
    `, 503)
  }
  
  try {
    // Forward request to target host
    const response = await forwardRequest(target, '/' + path + new URL(c.req.url).search, {
      method: c.req.method,
      headers: c.req.header(),
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.text() : undefined
    })
    
    // Update tunnel stats
    tunnel.requestCount++
    
    console.log(`📨 ${c.req.method} /${path} -> ${target.host}:${target.port} (${response.status})`)
    
    // Return the response
    const responseHeaders = {}
    Object.entries(response.headers).forEach(([key, value]) => {
      // Skip hop-by-hop headers
      if (!['connection', 'transfer-encoding', 'upgrade'].includes(key.toLowerCase())) {
        responseHeaders[key] = value
      }
    })
    
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    })
    
  } catch (error) {
    console.error('Proxy error:', error)
    
    return c.html(`
      <html>
        <head><title>Connection Error</title></head>
        <body style="font-family: Arial; text-align: center; margin-top: 100px;">
          <h1>🔌 Connection Error</h1>
          <p>Cannot connect to <code>${target.host}:${target.port}</code></p>
          <p>Error: ${error.message}</p>
          <p>Please make sure your local server is running on port ${target.port}</p>
          <a href="javascript:history.back()">← Go Back</a>
        </body>
      </html>
    `, 502)
  }
})

// Function to forward HTTP request
async function forwardRequest(target, path, options) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: target.host,
      port: target.port,
      path: path,
      method: options.method,
      headers: {},
      timeout: 30000
    }
    
    // Copy headers, skipping hop-by-hop headers
    Object.entries(options.headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase()
      if (!['host', 'connection', 'upgrade', 'content-length'].includes(lowerKey)) {
        requestOptions.headers[key] = value
      }
    })
    
    // Set content-length if there's a body
    if (options.body) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(options.body)
    }
    
    const req = http.request(requestOptions, (res) => {
      let body = ''
      
      res.on('data', (chunk) => {
        body += chunk
      })
      
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body
        })
      })
    })
    
    req.on('error', (error) => {
      reject(error)
    })
    
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
    
    // Send body if present
    if (options.body) {
      req.write(options.body)
    }
    
    req.end()
  })
}

// API test endpoint
app.get('/api/test', (c) => {
  return c.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    tunnels: tunnels.size,
    targets: targetHosts.size
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

console.log('🚀 Starting HTTP Polling Tunnelmole...')
console.log(`📡 Port: ${port}`)
console.log(`🖥️ Host: ${host}`)

serve({
  fetch: app.fetch,
  port: port,
  hostname: host
}, (info) => {
  console.log(`✅ Server running at http://${info.address}:${info.port}`)
  console.log(`🏥 Health: http://${info.address}:${info.port}/health`)
  console.log(`📊 Dashboard: http://${info.address}:${info.port}`)
})

export default app
