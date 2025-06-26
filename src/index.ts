// src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { TunnelManager } from './tunnel.js'
import { setupWebSocket } from './websocket.js'
import type { Tunnel, TunnelRequest, TunnelResponse } from './types.js'

// Initialize Hono app
const app = new Hono()

// Initialize tunnel manager
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
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        .logo {
            font-size: 3rem;
            margin-bottom: 10px;
        }
        .subtitle {
            font-size: 1.2rem;
            opacity: 0.8;
        }
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
        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            color: #4ade80;
        }
        .api-section {
            margin-top: 30px;
        }
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
        .tunnels-list {
            margin-top: 20px;
        }
        .tunnel-item {
            background: rgba(0, 0, 0, 0.2);
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
        }
        .tunnel-url {
            color: #60a5fa;
            text-decoration: none;
            font-weight: bold;
        }
        .tunnel-url:hover {
            color: #93c5fd;
        }
        .status-connected {
            color: #4ade80;
        }
        .status-disconnected {
            color: #f87171;
        }
        .refresh-btn {
            background: #4ade80;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
        }
        .refresh-btn:hover {
            background: #22c55e;
        }
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
                <div class="stat-number" id="totalRequests">0</div>
                <div>Total Requests</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="uptime">0</div>
                <div>Uptime (seconds)</div>
            </div>
        </div>

        <div class="card">
            <h2>🔗 API Endpoints</h2>
            <div class="api-section">
                <div class="endpoint">
                    <span class="method post">POST</span>
                    <strong>/api/tunnel/create</strong> - Create new tunnel
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>
                    <strong>/api/tunnel/:id</strong> - Get tunnel info
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>
                    <strong>/api/tunnels</strong> - List all tunnels
                </div>
                <div class="endpoint">
                    <span class="method delete">DELETE</span>
                    <strong>/api/tunnel/:id</strong> - Delete tunnel
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>
                    <strong>/t/:id/*</strong> - Proxy to local service
                </div>
            </div>
        </div>

        <div class="card">
            <h2>🌐 Active Tunnels</h2>
            <button class="refresh-btn" onclick="refreshData()">🔄 Refresh</button>
            <div class="tunnels-list" id="tunnelsList">
                <p>Loading tunnels...</p>
            </div>
        </div>

        <div class="card">
            <h2>📚 Quick Start</h2>
            <p>1. Download the local client:</p>
            <div class="endpoint">curl -O ${c.req.url}client/local-client.js</div>
            
            <p>2. Run your local app (e.g., port 3000):</p>
            <div class="endpoint">npm start</div>
            
            <p>3. Connect to tunnel:</p>
            <div class="endpoint">node local-client.js --port 3000 --server ${c.req.url}</div>
        </div>
    </div>

    <script>
        async function refreshData() {
            try {
                // Get health stats
                const healthRes = await fetch('/health');
                const health = await healthRes.json();
                
                document.getElementById('activeTunnels').textContent = health.activeTunnels;
                document.getElementById('uptime').textContent = Math.floor(health.uptime);
                
                // Get tunnels list
                const tunnelsRes = await fetch('/api/tunnels');
                const tunnelsData = await tunnelsRes.json();
                
                const tunnelsList = document.getElementById('tunnelsList');
                if (tunnelsData.tunnels.length === 0) {
                    tunnelsList.innerHTML = '<p>No active tunnels</p>';
                } else {
                    tunnelsList.innerHTML = tunnelsData.tunnels.map(tunnel => \`
                        <div class="tunnel-item">
                            <div>
                                <strong>ID:</strong> \${tunnel.id}
                                <span class="\${tunnel.connected ? 'status-connected' : 'status-disconnected'}">
                                    \${tunnel.connected ? '🟢 Connected' : '🔴 Disconnected'}
                                </span>
                            </div>
                            <div>
                                <strong>URL:</strong> 
                                <a href="/t/\${tunnel.id}/" target="_blank" class="tunnel-url">
                                    \${window.location.origin}/t/\${tunnel.id}/
                                </a>
                            </div>
                            <div><strong>Local Port:</strong> \${tunnel.localPort}</div>
                            <div><strong>Requests:</strong> \${tunnel.requestCount}</div>
                            <div><strong>Created:</strong> \${new Date(tunnel.createdAt).toLocaleString()}</div>
                        </div>
                    \`).join('');
                }
                
            } catch (error) {
                console.error('Failed to refresh data:', error);
            }
        }
        
        // Auto-refresh every 5 seconds
        setInterval(refreshData, 5000);
        
        // Initial load
        refreshData();
    </script>
</body>
</html>
  `
  return c.html(html)
})

// API Routes

// Create tunnel
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

// Get tunnel info
app.get('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  const tunnel = tunnelManager.getTunnel(id)
  
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  return c.json(tunnel)
})

// List all tunnels
app.get('/api/tunnels', (c) => {
  const tunnels = tunnelManager.getAllTunnels()
  return c.json({ tunnels })
})

// Delete tunnel
app.delete('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  const success = tunnelManager.deleteTunnel(id)
  
  if (!success) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  return c.json({ success: true, message: 'Tunnel deleted' })
})

// Proxy requests to local machine
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
      hint: 'Make sure your local client is running and connected',
      tunnelId 
    }, 503)
  }
  
  try {
    // Create request ID for tracking
    const requestId = tunnelManager.generateId()
    
    // Prepare request data
    const requestData: TunnelRequest = {
      id: requestId,
      method: c.req.method,
      path: '/' + path,
      query: Object.fromEntries(new URL(c.req.url).searchParams.entries()),
      headers: Object.fromEntries(c.req.header()),
      body: c.req.method !== 'GET' ? await c.req.text() : undefined
    }
    
    // Send request through WebSocket and wait for response
    const response = await tunnelManager.sendRequest(tunnelId, requestData)
    
    if (!response) {
      return c.json({ error: 'Request timeout' }, 504)
    }
    
    // Update tunnel stats
    tunnel.requestCount++
    tunnel.lastActivity = new Date()
    
    // Return response
    c.status(response.status || 200)
    
    // Set response headers
    if (response.headers) {
      Object.entries(response.headers).forEach(([key, value]) => {
        c.header(key, value as string)
      })
    }
    
    return c.body(response.body || '')
    
  } catch (error) {
    console.error('Proxy error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Serve local client script
app.get('/client/local-client.js', (c) => {
  // Return the local client script (we'll create this file)
  return c.text(`// Local client script will be served here`)
})

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

// Start server
const port = parseInt(process.env.PORT || '3000')

// Create HTTP server for WebSocket upgrade
const server = createServer()

// Setup WebSocket server
const wss = new WebSocketServer({ server })
setupWebSocket(wss, tunnelManager)

// Handle HTTP requests with Hono
server.on('request', serve(app).fetch)

server.listen(port, () => {
  console.log(`🚇 Hono Tunnelmole server running on port ${port}`)
  console.log(`📊 Dashboard: http://localhost:${port}`)
  console.log(`🔗 API: http://localhost:${port}/api`)
})

export default app
