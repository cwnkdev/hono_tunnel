// src/index.js
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'

// Tunnel Manager Class
class TunnelManager {
  constructor() {
    this.tunnels = new Map()
    this.connections = new Map()
    this.pendingRequests = new Map()
  }

  generateId() {
    return uuidv4().split('-')[0]
  }

  createTunnel(localPort, subdomain) {
    const id = subdomain || this.generateId()
    
    if (this.tunnels.has(id)) {
      throw new Error('Tunnel ID already exists')
    }

    const tunnel = {
      id,
      localPort,
      createdAt: new Date(),
      lastActivity: new Date(),
      requestCount: 0,
      connected: false
    }

    this.tunnels.set(id, tunnel)
    console.log(`✅ Tunnel created: ${id} -> localhost:${localPort}`)
    
    return tunnel
  }

  getTunnel(id) {
    return this.tunnels.get(id)
  }

  getAllTunnels() {
    return Array.from(this.tunnels.values())
  }

  getActiveTunnelsCount() {
    return Array.from(this.tunnels.values()).filter(t => t.connected).length
  }

  deleteTunnel(id) {
    const tunnel = this.tunnels.get(id)
    if (!tunnel) {
      return false
    }

    const connection = this.connections.get(id)
    if (connection) {
      connection.close()
      this.connections.delete(id)
    }

    this.tunnels.delete(id)
    console.log(`🗑️  Tunnel deleted: ${id}`)
    return true
  }

  connectWebSocket(tunnelId, ws) {
    const tunnel = this.tunnels.get(tunnelId)
    if (!tunnel) {
      return false
    }

    const existingConnection = this.connections.get(tunnelId)
    if (existingConnection) {
      existingConnection.close()
    }

    this.connections.set(tunnelId, ws)
    tunnel.connected = true
    tunnel.lastActivity = new Date()

    console.log(`🔌 WebSocket connected for tunnel: ${tunnelId}`)
    return true
  }

  disconnectWebSocket(tunnelId) {
    const tunnel = this.tunnels.get(tunnelId)
    if (tunnel) {
      tunnel.connected = false
    }

    this.connections.delete(tunnelId)
    console.log(`🔌 WebSocket disconnected for tunnel: ${tunnelId}`)
  }

  async sendRequest(tunnelId, request) {
    const connection = this.connections.get(tunnelId)
    if (!connection) {
      throw new Error('No active connection for tunnel')
    }

    return new Promise((resolve, reject) => {
      const requestKey = `${tunnelId}-${request.id}`
      
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestKey)
        reject(new Error('Request timeout'))
      }, 30000)

      this.pendingRequests.set(requestKey, {
        resolve,
        reject,
        timeout
      })

      const message = JSON.stringify({
        type: 'http_request',
        ...request
      })

      try {
        connection.send(message)
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRequests.delete(requestKey)
        reject(error)
      }
    })
  }

  handleResponse(tunnelId, response) {
    const requestKey = `${tunnelId}-${response.requestId}`
    const pending = this.pendingRequests.get(requestKey)
    
    if (pending) {
      clearTimeout(pending.timeout)
      pending.resolve(response)
      this.pendingRequests.delete(requestKey)
    }
  }
}

// Initialize
const app = new Hono()
const tunnelManager = new TunnelManager()

// Middleware
app.use('*', logger())
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeTunnels: tunnelManager.getActiveTunnelsCount(),
    version: '1.0.0'
  })
})

// Dashboard - Web UI
app.get('/', (c) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🚇 Hono Tunnelmole</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 40px; }
        .logo { font-size: 3rem; margin-bottom: 10px; }
        .subtitle { font-size: 1.2rem; opacity: 0.8; }
        .card {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 20px;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat {
            text-align: center;
            padding: 20px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
        }
        .stat-number { font-size: 2rem; font-weight: bold; color: #4ade80; }
        .endpoint {
            background: rgba(0, 0, 0, 0.2);
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            font-family: 'Courier New', monospace;
        }
        .method {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: bold;
            margin-right: 10px;
        }
        .get { background: #10b981; }
        .post { background: #3b82f6; }
        .delete { background: #ef4444; }
        .refresh-btn {
            background: #4ade80;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
        }
        .tunnel-item {
            background: rgba(0, 0, 0, 0.2);
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
        }
        .tunnel-url { color: #60a5fa; text-decoration: none; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🚇 Hono Tunnelmole</div>
            <div class="subtitle">Fast & Secure Tunneling Service</div>
        </div>

        <div class="stats">
            <div class="stat">
                <div class="stat-number" id="activeTunnels">0</div>
                <div>Active Tunnels</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="uptime">0</div>
                <div>Uptime (seconds)</div>
            </div>
        </div>

        <div class="card">
            <h2>🔗 API Endpoints</h2>
            <div class="endpoint">
                <span class="method post">POST</span>
                <strong>/api/tunnel/create</strong> - Create new tunnel
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <strong>/api/tunnels</strong> - List all tunnels
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <strong>/t/:id/*</strong> - Proxy to local service
            </div>
        </div>

        <div class="card">
            <h2>🌐 Active Tunnels</h2>
            <button class="refresh-btn" onclick="refreshData()">🔄 Refresh</button>
            <div id="tunnelsList">Loading...</div>
        </div>
    </div>

    <script>
        async function refreshData() {
            try {
                const healthRes = await fetch('/health');
                const health = await healthRes.json();
                document.getElementById('activeTunnels').textContent = health.activeTunnels;
                document.getElementById('uptime').textContent = Math.floor(health.uptime);
                
                const tunnelsRes = await fetch('/api/tunnels');
                const tunnelsData = await tunnelsRes.json();
                
                const list = document.getElementById('tunnelsList');
                if (tunnelsData.tunnels.length === 0) {
                    list.innerHTML = '<p>No active tunnels</p>';
                } else {
                    list.innerHTML = tunnelsData.tunnels.map(t => \`
                        <div class="tunnel-item">
                            <strong>\${t.id}</strong> - Port \${t.localPort}
                            <br><a href="/t/\${t.id}/" class="tunnel-url">/t/\${t.id}/</a>
                        </div>
                    \`).join('');
                }
            } catch (error) {
                console.error('Refresh failed:', error);
            }
        }
        setInterval(refreshData, 5000);
        refreshData();
    </script>
</body>
</html>`
  return c.html(html)
})

// API Routes
app.post('/api/tunnel/create', async (c) => {
  try {
    const body = await c.req.json()
    const { localPort, subdomain } = body

    if (!localPort) {
      return c.json({ error: 'Local port is required' }, 400)
    }

    const tunnel = tunnelManager.createTunnel(localPort, subdomain)
    const baseUrl = new URL(c.req.url).origin
    const publicUrl = `${baseUrl}/t/${tunnel.id}`
    const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/${tunnel.id}`

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
    return c.json({ error: 'Failed to create tunnel' }, 500)
  }
})

app.get('/api/tunnels', (c) => {
  const tunnels = tunnelManager.getAllTunnels()
  return c.json({ tunnels })
})

app.get('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  const tunnel = tunnelManager.getTunnel(id)
  
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  return c.json(tunnel)
})

app.delete('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  const success = tunnelManager.deleteTunnel(id)
  
  if (!success) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  return c.json({ success: true, message: 'Tunnel deleted' })
})

// Proxy requests
app.all('/t/:id/*', async (c) => {
  const tunnelId = c.req.param('id')
  const path = c.req.param('*') || ''
  
  const tunnel = tunnelManager.getTunnel(tunnelId)
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  if (!tunnel.connected) {
    return c.json({ 
      error: 'Tunnel not connected',
      hint: 'Make sure your local client is running'
    }, 503)
  }
  
  try {
    const requestId = tunnelManager.generateId()
    const url = new URL(c.req.url)
    
    const requestData = {
      id: requestId,
      method: c.req.method,
      path: '/' + path,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {},
      body: c.req.method !== 'GET' ? await c.req.text() : undefined
    }
    
    // Copy headers
    for (const [key, value] of Object.entries(c.req.header())) {
      requestData.headers[key] = value
    }
    
    const response = await tunnelManager.sendRequest(tunnelId, requestData)
    
    if (!response) {
      return c.json({ error: 'Request timeout' }, 504)
    }
    
    tunnel.requestCount++
    tunnel.lastActivity = new Date()
    
    // Set response
    if (response.headers) {
      Object.entries(response.headers).forEach(([key, value]) => {
        c.header(key, String(value))
      })
    }
    
    return new Response(response.body || '', {
      status: response.status || 200,
      headers: response.headers || {}
    })
    
  } catch (error) {
    console.error('Proxy error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Serve client script
app.get('/client/local-client.js', async (c) => {
  try {
    const clientPath = path.join(process.cwd(), 'client', 'local-client.js')
    const clientScript = fs.readFileSync(clientPath, 'utf-8')
    c.header('Content-Type', 'application/javascript')
    return c.text(clientScript)
  } catch (error) {
    return c.text('// Local client script not found', 404)
  }
})

// Setup WebSocket
function setupWebSocket(wss, tunnelManager) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const pathParts = url.pathname.split('/')
    
    if (pathParts.length !== 3 || pathParts[1] !== 'ws') {
      ws.close(1002, 'Invalid WebSocket path')
      return
    }
    
    const tunnelId = pathParts[2]
    const tunnel = tunnelManager.getTunnel(tunnelId)
    
    if (!tunnel) {
      ws.close(1002, 'Tunnel not found')
      return
    }
    
    const connected = tunnelManager.connectWebSocket(tunnelId, ws)
    if (!connected) {
      ws.close(1002, 'Failed to connect tunnel')
      return
    }
    
    ws.send(JSON.stringify({
      type: 'connected',
      tunnelId,
      message: 'Successfully connected to tunnel'
    }))
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        
        if (message.type === 'http_response') {
          tunnelManager.handleResponse(tunnelId, {
            requestId: message.requestId,
            status: message.status,
            headers: message.headers,
            body: message.body
          })
        }
      } catch (error) {
        console.error('WebSocket message error:', error)
      }
    })
    
    ws.on('close', () => {
      tunnelManager.disconnectWebSocket(tunnelId)
    })
    
    ws.on('error', (error) => {
      console.error(`WebSocket error for tunnel ${tunnelId}:`, error)
      tunnelManager.disconnectWebSocket(tunnelId)
    })
  })
}

// Start server
const port = parseInt(process.env.PORT || '3000')
const server = createServer()

const wss = new WebSocketServer({ server })
setupWebSocket(wss, tunnelManager)

server.on('request', (req, res) => {
  serve(app)(req, res)
})

server.listen(port, () => {
  console.log(`🚇 Hono Tunnelmole server running on port ${port}`)
  console.log(`📊 Dashboard: http://localhost:${port}`)
})

export default app
