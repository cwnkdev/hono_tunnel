// src/websocket.ts
import type { WebSocketServer, WebSocket } from 'ws'
import type { TunnelManager } from './tunnel.js'
import type { TunnelResponse } from './types.js'

export function setupWebSocket(wss: WebSocketServer, tunnelManager: TunnelManager) {
  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const pathParts = url.pathname.split('/')
    
    // Expected path: /ws/{tunnelId}
    if (pathParts.length !== 3 || pathParts[1] !== 'ws') {
      ws.close(1002, 'Invalid WebSocket path')
      return
    }
    
    const tunnelId = pathParts[2]
    
    // Verify tunnel exists
    const tunnel = tunnelManager.getTunnel(tunnelId)
    if (!tunnel) {
      ws.close(1002, 'Tunnel not found')
      return
    }
    
    // Connect WebSocket to tunnel
    const connected = tunnelManager.connectWebSocket(tunnelId, ws)
    if (!connected) {
      ws.close(1002, 'Failed to connect tunnel')
      return
    }
    
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
        handleWebSocketMessage(tunnelId, message, tunnelManager)
      } catch (error) {
        console.error('WebSocket message parse error:', error)
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON message'
        }))
      }
    })
    
    // Handle connection close
    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket disconnected for tunnel: ${tunnelId} (${code}: ${reason})`)
      tunnelManager.disconnectWebSocket(tunnelId)
    })
    
    // Handle connection error
    ws.on('error', (error) => {
      console.error(`WebSocket error for tunnel ${tunnelId}:`, error)
      tunnelManager.disconnectWebSocket(tunnelId)
    })
    
    // Send ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
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

function handleWebSocketMessage(
  tunnelId: string, 
  message: any, 
  tunnelManager: TunnelManager
) {
  switch (message.type) {
    case 'http_response':
      // Handle HTTP response from local client
      const response: TunnelResponse = {
        requestId: message.requestId,
        status: message.status,
        headers: message.headers,
        body: message.body
      }
      tunnelManager.handleResponse(tunnelId, response)
      break
      
          case 'ping':
      // Handle ping from client
      const tunnel = tunnelManager.getTunnel(tunnelId)
      if (tunnel) {
        tunnel.lastActivity = new Date()
        // Send pong back
        const connection = tunnelManager.getConnection(tunnelId)
        if (connection) {
          connection.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now()
          }))
        }
      }
      break
      
    case 'status':
      // Handle status update from client
      console.log(`📊 Status update from tunnel ${tunnelId}:`, message.data)
      break
      
    case 'error':
      // Handle error from client
      console.error(`❌ Error from tunnel ${tunnelId}:`, message.error)
      break
      
    default:
      console.warn(`⚠️  Unknown message type from tunnel ${tunnelId}:`, message.type)
      break
  }
}
