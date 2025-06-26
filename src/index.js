// src/index.js - เพิ่ม API endpoints ที่ขาดหาย
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { v4 as uuidv4 } from 'uuid'

const app = new Hono()

// In-memory storage
const tunnels = new Map()
const connections = new Map()

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
    activeTunnels: tunnels.size
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
        .endpoints { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .endpoint { font-family: monospace; background: #e9ecef; padding: 8px; margin: 5px 0; border-radius: 3px; }
        .tunnels { margin: 20px 0; }
        .tunnel { background: #fff3cd; padding: 10px; margin: 10px 0; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🚇 Hono Tunnelmole</div>
        
        <div class="status">
            <h3>✅ Server Status: Online</h3>
            <p>Server is running and ready to accept tunnels</p>
            <p>Active Tunnels: <span id="tunnelCount">${tunnels.size}</span></p>
        </div>

        <div class="endpoints">
            <h3>🔗 API Endpoints</h3>
            <div class="endpoint">POST /api/tunnel/create - Create new tunnel</div>
            <div class="endpoint">GET /api/tunnels - List all tunnels</div>
            <div class="endpoint">GET /api/tunnel/:id - Get tunnel info</div>
            <div class="endpoint">DELETE /api/tunnel/:id - Delete tunnel</div>
            <div class="endpoint">GET /t/:id/* - Proxy to local service</div>
        </div>

        <div class="tunnels">
            <h3>🌐 Active Tunnels</h3>
            <div id="tunnelsList">
                ${Array.from(tunnels.values()).map(tunnel => `
                    <div class="tunnel">
                        <strong>ID:</strong> ${tunnel.id}<br>
                        <strong>Port:</strong> ${tunnel.localPort}<br>
                        <strong>URL:</strong> <a href="/t/${tunnel.id}/" target="_blank">/t/${tunnel.id}/</a><br>
                        <strong>Created:</strong> ${tunnel.createdAt.toLocaleString()}
                    </div>
                `).join('') || '<p>No active tunnels</p>'}
            </div>
        </div>

        <div class="endpoints">
            <h3>📚 How to Use</h3>
            <p>1. Install client dependencies:</p>
            <div class="endpoint">npm install ws</div>
            
            <p>2. Run your local app:</p>
            <div class="endpoint">npm start  # or python -m http.server 3000</div>
            
            <p>3. Create a tunnel:</p>
            <div class="endpoint">curl -X POST ${new URL(c.req.url).origin}/api/tunnel/create -H "Content-Type: application/json" -d '{"localPort": 3000}'</div>
            
            <p>4. Access via public URL:</p>
            <div class="endpoint">${new URL(c.req.url).origin}/t/TUNNEL_ID/</div>
        </div>
    </div>

    <script>
        // Auto-refresh tunnel count
        setInterval(async () => {
            try {
                const response = await fetch('/api/tunnels');
                const data = await response.json();
                document.getElementById('tunnelCount').textContent = data.tunnels.length;
                
                const list = document.getElementById('tunnelsList');
                if (data.tunnels.length === 0) {
                    list.innerHTML = '<p>No active tunnels</p>';
                } else {
                    list.innerHTML = data.tunnels.map(tunnel => \`
                        <div class="tunnel">
                            <strong>ID:</strong> \${tunnel.id}<br>
                            <strong>Port:</strong> \${tunnel.localPort}<br>
                            <strong>URL:</strong> <a href="/t/\${tunnel.id}/" target="_blank">/t/\${tunnel.id}/</a><br>
                            <strong>Created:</strong> \${new Date(tunnel.createdAt).toLocaleString()}
                        </div>
                    \`).join('');
                }
            } catch (error) {
                console.error('Failed to refresh:', error);
            }
        }, 5000);
    </script>
</body>
</html>`
  
  return c.html(html)
})

// ✅ CREATE TUNNEL API
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

// ✅ LIST TUNNELS API
app.get('/api/tunnels', (c) => {
  const tunnelList = Array.from(tunnels.values())
  return c.json({ tunnels: tunnelList })
})

// ✅ GET TUNNEL INFO API
app.get('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  const tunnel = tunnels.get(id)
  
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  return c.json(tunnel)
})

// ✅ DELETE TUNNEL API
app.delete('/api/tunnel/:id', (c) => {
  const id = c.req.param('id')
  
  if (tunnels.has(id)) {
    tunnels.delete(id)
    connections.delete(id)
    console.log(`🗑️ Tunnel deleted: ${id}`)
    return c.json({ success: true, message: 'Tunnel deleted' })
  } else {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
})

// ✅ PROXY REQUESTS
app.all('/t/:id/*', async (c) => {
  const tunnelId = c.req.param('id')
  const path = c.req.param('*') || ''
  
  const tunnel = tunnels.get(tunnelId)
  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404)
  }
  
  // For now, return a simple response (WebSocket implementation would go here)
  tunnel.requestCount++
  tunnel.lastActivity = new Date()
  
  return c.json({
    message: 'Tunnel proxy endpoint',
    tunnelId,
    path: '/' + path,
    info: 'WebSocket implementation needed for actual proxying',
    localPort: tunnel.localPort,
    requestCount: tunnel.requestCount
  })
})

// ✅ TEST ENDPOINT
app.get('/api/test', (c) => {
  return c.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /api/tunnel/create',
      'GET /api/tunnels', 
      'GET /api/tunnel/:id',
      'DELETE /api/tunnel/:id'
    ]
  })
})

// 404 handler
app.notFound((c) => {
  return c.json({ 
    error: 'Not found',
    path: c.req.url,
    method: c.req.method,
    available_endpoints: [
      'GET /',
      'GET /health',
      'POST /api/tunnel/create',
      'GET /api/tunnels',
      'GET /api/test'
    ]
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

console.log('🚀 Starting Hono Tunnelmole server...')
console.log(`📡 Port: ${port}`)
console.log(`🖥️ Host: ${host}`)

serve({
  fetch: app.fetch,
  port: port,
  hostname: host
}, (info) => {
  console.log(`✅ Server running at http://${info.address}:${info.port}`)
  console.log(`🏥 Health check: http://${info.address}:${info.port}/health`)
  console.log(`📊 Dashboard: http://${info.address}:${info.port}`)
})

export default app
