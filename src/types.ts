// src/types.ts

export interface Tunnel {
  id: string
  localPort: number
  createdAt: Date
  lastActivity: Date
  requestCount: number
  connected: boolean
}

export interface TunnelRequest {
  id: string
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body?: string
}

export interface TunnelResponse {
  requestId: string
  status: number
  headers?: Record<string, string>
  body?: string
}

export interface WebSocketMessage {
  type: 'connected' | 'http_request' | 'http_response' | 'ping' | 'pong' | 'status' | 'error'
  [key: string]: any
}

export interface CreateTunnelRequest {
  localPort: number
  subdomain?: string
}

export interface CreateTunnelResponse {
  success: boolean
  tunnel: {
    id: string
    publicUrl: string
    wsUrl: string
    localPort: number
    createdAt: Date
  }
}

export interface TunnelStats {
  total: number
  active: number
  totalRequests: number
  oldestTunnel: Tunnel | null
}
