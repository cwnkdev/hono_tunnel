// src/tunnel.ts
import { v4 as uuidv4 } from 'uuid'
import type { Tunnel, TunnelRequest, TunnelResponse } from './types.js'
import type { WebSocket } from 'ws'

export class TunnelManager {
  private tunnels = new Map<string, Tunnel>()
  private connections = new Map<string, WebSocket>()
  private pendingRequests = new Map<string, {
    resolve: (response: TunnelResponse) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()

  generateId(): string {
    return uuidv4().split('-')[0] // Short ID
  }

  createTunnel(localPort: number, subdomain?: string): Tunnel {
    const id = subdomain || this.generateId()
    
    // Check if subdomain already exists
    if (this.tunnels.has(id)) {
      throw new Error('Tunnel ID already exists')
    }

    const tunnel: Tunnel = {
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

  getTunnel(id: string): Tunnel | undefined {
    return this.tunnels.get(id)
  }

  getAllTunnels(): Tunnel[] {
    return Array.from(this.tunnels.values())
  }

  getActiveTunnelsCount(): number {
    return Array.from(this.tunnels.values()).filter(t => t.connected).length
  }

  deleteTunnel(id: string): boolean {
    const tunnel = this.tunnels.get(id)
    if (!tunnel) {
      return false
    }

    // Close WebSocket connection
    const connection = this.connections.get(id)
    if (connection) {
      connection.close()
      this.connections.delete(id)
    }

    // Reject any pending requests
    const pendingKeys = Array.from(this.pendingRequests.keys())
    pendingKeys.forEach(requestId => {
      if (requestId.startsWith(id)) {
        const pending = this.pendingRequests.get(requestId)
        if (pending) {
          clearTimeout(pending.timeout)
          pending.reject(new Error('Tunnel deleted'))
          this.pendingRequests.delete(requestId)
        }
      }
    })

    this.tunnels.delete(id)
    console.log(`🗑️  Tunnel deleted: ${id}`)
    
    return true
  }

  connectWebSocket(tunnelId: string, ws: WebSocket): boolean {
    const tunnel = this.tunnels.get(tunnelId)
    if (!tunnel) {
      return false
    }

    // Close existing connection if any
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

  getConnection(tunnelId: string): WebSocket | undefined {
    return this.connections.get(tunnelId)
  }

  disconnectWebSocket(tunnelId: string): void {
    const tunnel = this.tunnels.get(tunnelId)
    if (tunnel) {
      tunnel.connected = false
    }

    this.connections.delete(tunnelId)
    console.log(`🔌 WebSocket disconnected for tunnel: ${tunnelId}`)
  }

  async sendRequest(tunnelId: string, request: TunnelRequest): Promise<TunnelResponse | null> {
    const connection = this.connections.get(tunnelId)
    if (!connection) {
      throw new Error('No active connection for tunnel')
    }

    return new Promise((resolve, reject) => {
      const requestKey = `${tunnelId}-${request.id}`
      
      // Set timeout for request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestKey)
        reject(new Error('Request timeout'))
      }, 30000) // 30 second timeout

      // Store pending request
      this.pendingRequests.set(requestKey, {
        resolve,
        reject,
        timeout
      })

      // Send request to local client
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

  handleResponse(tunnelId: string, response: TunnelResponse): void {
    const requestKey = `${tunnelId}-${response.requestId}`
    const pending = this.pendingRequests.get(requestKey)
    
    if (pending) {
      clearTimeout(pending.timeout)
      pending.resolve(response)
      this.pendingRequests.delete(requestKey)
    }
  }

  // Cleanup inactive tunnels
  cleanup(): void {
    const now = new Date()
    const maxInactiveTime = 24 * 60 * 60 * 1000 // 24 hours

    for (const [id, tunnel] of this.tunnels.entries()) {
      const inactiveTime = now.getTime() - tunnel.lastActivity.getTime()
      
      if (inactiveTime > maxInactiveTime && !tunnel.connected) {
        console.log(`🧹 Cleaning up inactive tunnel: ${id}`)
        this.deleteTunnel(id)
      }
    }
  }

  // Get tunnel statistics
  getStats() {
    const tunnels = Array.from(this.tunnels.values())
    
    return {
      total: tunnels.length,
      active: tunnels.filter(t => t.connected).length,
      totalRequests: tunnels.reduce((sum, t) => sum + t.requestCount, 0),
      oldestTunnel: tunnels.reduce((oldest, tunnel) => 
        !oldest || tunnel.createdAt < oldest.createdAt ? tunnel : oldest, 
        null as Tunnel | null
      )
    }
  }

  // Start cleanup interval
  startCleanupInterval(): void {
    setInterval(() => {
      this.cleanup()
    }, 60 * 60 * 1000) // Run every hour
  }
}
