// src/index.js - Real HTTP Proxy Implementation
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { v4 as uuidv4 } from 'uuid'

const app = new Hono()

// In-memory storage
const tunnels = new Map()
const connections = new Map()
const pendingRequests = new Map()

// Helper functions
function generateId() {
  return uuidv4().split('-')[0]
}

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: process.env.PORT || '3000',
    host: '0.0.0.0',
    activeTunnels: tunnels.size,
    activeConnections: connections.size
  })
})

// Dashboard
app.get('/', (c) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>🚇 Hono Tunnelmole</title>
    <style>
        body { font-family: Arial; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
        .logo { font-size: 2rem; text-align: center; margin-bottom: 20px; }
        .status { background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .endpoint { font-family: monospace; background: #e9ecef; padding: 8px; margin: 5px 0; border-radius: 3px; }
        .tunnel { background: #fff3cd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .success { color: #28a745; }
        .warning { color: #ffc107; }
        .error { color: #dc3545; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🚇 Hono Tunnelmole Pro</div>
        
        <div class="status">
            <h3>✅ Server Status: Online with Real Proxying</h3>
            <p>Active Tunnels: <span class="success">${tunnels.size}</span></p>
            <p>WebSocket Connections: <span class="success">${connections.size}</span></p>
        </div>

        <div class="status">
            <h3>🌐 Active Tunnels</h3>
            <div id="tunnelsList">
                ${Array.from(tunnels.values()).map(tunnel => `
                    <div class="tunnel">
                        <strong>ID:</strong> ${tunnel.id}<br>
                        <strong>Port:</strong> ${tunnel.localPort}<br>
                        <strong>URL:</strong> <a href="/t/${tunnel.id}/" target="_blank">/t/${tunnel.id}/</a><br>
                        <strong>Status:</strong> <span class="${tunnel.connected ? 'success' : 'error'}">${tunnel.connected ? 'Connected' : 'Disconnected'}</span><br>
                        <strong>Requests:</strong> ${tunnel.requestCount}<br>
                        <strong>Created:</strong> ${tunnel.createdAt.toLocaleString()}
                    </div>
                `).join('') || '<p>No active tunnels</p>'}
            </div>
        </div>

        <div class="status">
            <h3>📚 How to Connect</h3>
            <p>1. Create tunnel:</p>
            <div class="endpoint">curl -X POST ${new URL(c.req.url).origin}/api/tunnel/create -H "Content-Type: application/json" -d '{"localPort": 3000}'</div>
            
            <p>2. Connect WebSocket client (use the provided wsUrl)</p>
            
            <p>3. Access via public URL:</p>
            <div class="endpoint">${new URL(c.req.url).origin}/t/TUNNEL_ID/</div>
        </div>
    </div>

    <script>
        setInterval(async () => {
            try {
                const response = await fetch('/api/tunnels');
                const data = await response.json();
                
                const list = document.getElementById('tunnelsList');
                if (data.tunnels.length === 0) {
                    list.innerHTML = '<p>No active tunnels</p>';
                } else {
                    list.innerHTML = data.tunnels.map(tunnel => \`
                        <div class="tunnel">
                            <strong>ID:</strong> \${tunnel.id}<br>
                            <strong>Port:</strong> \${tunnel.localPort}<br>
                            <strong>URL:</strong> <a href="/t/\${tunnel.id}/" target="_blank">/t/\${tunnel.id}/</a><br>
                            <strong>Status:</strong> <span class="\${tunnel.connected ? 'success' : 'error'}">\${tunnel.connected ? 'Connected' : 'Disconnected'}</span><br>
                            <strong>Requests:</strong> \${tunnel.requestCount}<br>
                            <strong>Created:</strong> \${new Date(tunnel.createdAt).toLocaleString()}
                        </div>
                    \`).join('');
                }
            } catch (error) {
                console.error('Failed to refresh:', error);
            }
        }, 3000);
    </script>
</body>
</html>`
  
  return c.html(html)
})

// CREATE TUNNEL API
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
      lastActivity: new Date(),
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

// LIST TUNNELS API
app.get('/api/tunnels', (c) => {
  const tunnelList = Array.from(tunnels.values())
  return c.json({ tunnels: tunnelList })
})

// GET TUNNEL INFO API
app.get('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  const tunnel = tunnels.get(id)
  
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  return c.json(tunnel)
})

// DELETE TUNNEL API
app.delete('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  
  if (tunnels.has(id)) {
    const connection = connections.get(id)
    if (connection) {
      connection.close()
    }
    
    tunnels.delete(id)
    connections.delete(id)
    console.log(`🗑️ Tunnel deleted: ${id}`)
    return c.json({ success: true, message: 'Tunnel deleted' })
  } else {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
})

// REAL PROXY REQUESTS - แก้ไขใหม่เพื่อทำ real proxying
app.all('/t/:id/*', async (c) => {
  const tunnelId = c.req.param('id')
  const path = c.req.param('*') || ''
  
  const tunnel = tunnels.get(tunnelId)
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  if (!tunnel.connected) {
    return c.html(`
      <html>
        <head><title>Tunnel Not Connected</title></head>
        <body style="font-family: Arial; text-align: center; margin-top: 100px;">
          <h1>🔌 Tunnel Not Connected</h1>
          <p>Tunnel ID: <code>${tunnelId}</code></p>
          <p>The local client is not connected to this tunnel.</p>
          <p>Please start your local client with:</p>
          <code style="background: #f5f5f5; padding: 10px; display: block; margin: 20px;">
            node fixed-client.js --port ${tunnel.localPort}
          </code>
          <a href="/" style="color: #007bff;">← Back to Dashboard</a>
        </body>
      </html>
    `, 503)
  }
  
  try {
    // Create request ID for tracking
    const requestId = generateId()
    
    // Get full URL and query parameters
    const url = new URL(c.req.url)
    const fullPath = '/' + path + url.search
    
    // Prepare request data
    const requestData = {
      id: requestId,
      method: c.req.method,
      path: fullPath,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {},
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.text() : undefined
    }
    
    // Copy important headers
    const headers = c.req.header()
    for (const [key, value] of Object.entries(headers)) {
      // Skip hop-by-hop headers
      if (!['host', 'connection', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding'].includes(key.toLowerCase())) {
        requestData.headers[key] = value
      }
    }
    
    // Send request through WebSocket and wait for response
    const response = await sendRequestToClient(tunnelId, requestData)
    
    if (!response) {
      return c.html(`
        <html>
          <head><title>Request Timeout</title></head>
          <body style="font-family: Arial; text-align: center; margin-top: 100px;">
            <h1>⏰ Request Timeout</h1>
            <p>The local server did not respond within 30 seconds.</p>
            <p>Please check if your local app is running on port ${tunnel.localPort}</p>
            <a href="javascript:history.back()" style="color: #007bff;">← Go Back</a>
          </body>
        </html>
      `, 504)
    }
    
    // Update tunnel stats
    tunnel.requestCount++
    tunnel.lastActivity = new Date()
    
    console.log(`📨 ${c.req.method} ${fullPath} -> ${response.status}`)
    
    // Create proper response
    const responseHeaders = response.headers || {}
    
    // Set response headers
    Object.entries(responseHeaders).forEach(([key, value]) => {
      if (typeof value === 'string') {
        c.header(key, value)
      }
    })
    
    // Return response with proper status and body
    return new Response(response.body || '', {
      status: response.status || 200,
      headers: responseHeaders
    })
    
  } catch (error) {
    console.error('Proxy error:', error)
    return c.html(`
      <html>
        <head><title>Proxy Error</title></head>
        <body style="font-family: Arial; text-align: center; margin-top: 100px;">
          <h1>❌ Proxy Error</h1>
          <p>Failed to proxy request to local server</p>
          <p>Error: ${error.message}</p>
          <a href="javascript:history.back()" style="color: #007bff;">← Go Back</a>
        </body>
      </html>
    `, 500)
  }
})

// Function to send request to client and wait for response
async function sendRequestToClient(tunnelId, requestData) {
  const connection = connections.get(tunnelId)
  if (!connection || connection.readyState !== 1) { // 1 = OPEN
    return null
  }
  
  return new Promise((resolve, reject) => {
    const requestKey = `${tunnelId}-${requestData.id}`
    
    // Set timeout for request
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestKey)
      resolve(null) // Return null instead of rejecting for timeout
    }, 30000) // 30 second timeout
    
    // Store pending request
    pendingRequests.set(requestKey, {
      resolve,
      reject,
      timeout
    })
    
    // Send request to local client
    const message = JSON.stringify({
      type: 'http_request',
      ...requestData
    })
    
    try {
      connection.send(message)
    } catch (error) {
      clearTimeout(timeout)
      pendingRequests.delete(requestKey)
      resolve(null)
    }
  })
}

// Handle WebSocket response
function handleResponse(tunnelId, response) {
  const requestKey = `${tunnelId}-${response.requestId}`
  const pending = pendingRequests.get(requestKey)
  
  if (pending) {
    clearTimeout(pending.timeout)
    pending.resolve(response)
    pendingRequests.delete(requestKey)
  }
}

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

// WebSocket setup
function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const pathParts = url.pathname.split('/')
    
    // Expected path: /ws/{tunnelId}
    if (pathParts.length !== 3 || pathParts[1] !== 'ws') {
      ws.close(1002, 'Invalid WebSocket path')
      return
    }
    
    const tunnelId = pathParts[2]
    
    // Verify tunnel exists
    const tunnel = tunnels.get(tunnelId)
    if (!tunnel) {
      ws.close(1002, 'Tunnel not found')
      return
    }
    
    // Close existing connection if any
    const existingConnection = connections.get(tunnelId)
    if (existingConnection) {
      existingConnection.close()
    }
    
    // Store new connection
    connections.set(tunnelId, ws)
    tunnel.connected = true
    tunnel.lastActivity = new Date()
    
    console.log(`🔌 WebSocket connected for tunnel: ${tunnelId}`)
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      tunnelId,
      message: 'Successfully connected to tunnel'
    }))
    
    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        
        if (message.type === 'http_response') {
          handleResponse(tunnelId, {
            requestId: message.requestId,
            status: message.status,
            headers: message.headers,
            body: message.body
          })
        } else if (message.type === 'ping') {
          tunnel.lastActivity = new Date()
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now()
          }))
        }
      } catch (error) {
        console.error('WebSocket message parse error:', error)
      }
    })
    
    // Handle connection close
    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket disconnected for tunnel: ${tunnelId} (${code}: ${reason})`)
      tunnel.connected = false
      connections.delete(tunnelId)
    })
    
    // Handle connection error
    ws.on('error', (error) => {
      console.error(`WebSocket error for tunnel ${tunnelId}:`, error)
      tunnel.connected = false
      connections.delete(tunnelId)
    })
    
    // Send ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) { // OPEN
        ws.ping()
      } else {
        clearInterval(pingInterval)
      }
    }, 30000)
    
    ws.on('close', () => {
      clearInterval(pingInterval)
    })
  })
  
  console.log('🌐 WebSocket server initialized')
}

// Start server
const port = parseInt(process.env.PORT || '3000')
const host = '0.0.0.0'

// Create HTTP server for WebSocket upgrade
const server = createServer()

// Setup WebSocket server
const wss = new WebSocketServer({ server })
setupWebSocket(wss)

// Handle HTTP requests with Hono
server.on('request', (req, res) => {
  serve(app)(req, res)
})

server.listen(port, host, () => {
  console.log(`✅ Hono Tunnelmole Pro server running on ${host}:${port}`)
  console.log(`📊 Dashboard: http://${host}:${port}`)
  console.log(`🚇 Real HTTP proxying enabled`)
})

export default app
