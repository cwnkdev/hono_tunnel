#!/usr/bin/env node
// local-client.js - Working version for Railway Hono Tunnelmole

const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { URL } = require('url');

class TunnelClient {
  constructor(options) {
    this.serverUrl = options.serverUrl;
    this.localPort = options.localPort;
    this.subdomain = options.subdomain;
    this.tunnelId = null;
    this.publicUrl = null;
    this.wsUrl = null;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 5000;
  }

  async start() {
    try {
      console.log('🚇 Starting Hono Tunnelmole Client...');
      console.log(`📡 Server: ${this.serverUrl}`);
      console.log(`🏠 Local Port: ${this.localPort}`);
      
      // Test server connectivity first
      await this.testServerConnectivity();
      
      // Create tunnel
      await this.createTunnel();
      
      // Connect WebSocket
      await this.connectWebSocket();
      
      console.log('✅ Tunnel established successfully!');
      console.log(`🌐 Public URL: ${this.publicUrl}`);
      console.log(`🔗 Tunnel ID: ${this.tunnelId}`);
      console.log('🎯 Press Ctrl+C to stop');
      
      // Start ping interval
      this.startPingInterval();
      
    } catch (error) {
      console.error('❌ Failed to start tunnel:', error.message);
      process.exit(1);
    }
  }

  async testServerConnectivity() {
    try {
      console.log('🔍 Testing server connectivity...');
      const response = await this.httpRequest('GET', `${this.serverUrl}/health`);
      const data = JSON.parse(response);
      console.log(`✅ Server is healthy: ${data.status}`);
    } catch (error) {
      throw new Error(`Cannot connect to server: ${error.message}`);
    }
  }

  async createTunnel() {
    console.log('🔧 Creating tunnel...');
    
    const url = `${this.serverUrl}/api/tunnel/create`;
    const payload = {
      localPort: this.localPort
    };
    
    if (this.subdomain) {
      payload.subdomain = this.subdomain;
    }

    try {
      const response = await this.httpRequest('POST', url, payload);
      const data = JSON.parse(response);
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to create tunnel');
      }
      
      this.tunnelId = data.tunnel.id;
      this.publicUrl = data.tunnel.publicUrl;
      this.wsUrl = data.tunnel.wsUrl;
      
      console.log(`✅ Tunnel created: ${this.tunnelId}`);
      
    } catch (error) {
      throw new Error(`Failed to create tunnel: ${error.message}`);
    }
  }

  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      console.log(`🔌 Connecting to WebSocket: ${this.wsUrl}`);
      
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.on('open', () => {
        console.log('🔗 WebSocket connected');
        this.reconnectAttempts = 0;
        resolve();
      });
      
      this.ws.on('message', (data) => {
        this.handleWebSocketMessage(data);
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`🔌 WebSocket disconnected (${code}: ${reason})`);
        this.attemptReconnect();
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        reject(error);
      });
      
      // Timeout for initial connection
      setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  handleWebSocketMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'connected':
          console.log('✅ Successfully connected to tunnel');
          break;
          
        case 'http_request':
          this.handleHttpRequest(message);
          break;
          
        case 'pong':
          // Handle pong response for keep-alive
          break;
          
        case 'error':
          console.error('❌ Server error:', message.message);
          break;
          
        default:
          console.log('📥 Unknown message type:', message.type);
      }
      
    } catch (error) {
      console.error('❌ Failed to parse WebSocket message:', error.message);
    }
  }

  async handleHttpRequest(request) {
    try {
      console.log(`📨 ${request.method} ${request.path}`);
      
      // Test if local server is running
      const isLocalServerRunning = await this.testLocalServer();
      if (!isLocalServerRunning) {
        this.sendErrorResponse(request.id, 503, 'Local server not running');
        return;
      }
      
      // Forward request to local server
      const response = await this.forwardToLocal(request);
      
      // Send response back through WebSocket
      this.ws.send(JSON.stringify({
        type: 'http_response',
        requestId: request.id,
        status: response.status,
        headers: response.headers,
        body: response.body
      }));
      
    } catch (error) {
      console.error('❌ Failed to handle request:', error.message);
      this.sendErrorResponse(request.id, 500, error.message);
    }
  }

  async testLocalServer() {
    try {
      await this.httpRequest('GET', `http://localhost:${this.localPort}/`, null, 1000);
      return true;
    } catch (error) {
      return false;
    }
  }

  sendErrorResponse(requestId, status, message) {
    this.ws.send(JSON.stringify({
      type: 'http_response',
      requestId: requestId,
      status: status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: message,
        timestamp: new Date().toISOString()
      })
    }));
  }

  async forwardToLocal(request) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: this.localPort,
        path: request.path + this.buildQueryString(request.query),
        method: request.method,
        headers: this.filterHeaders(request.headers),
        timeout: 30000
      };

      const req = http.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body
          });
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Local server error: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout to local server'));
      });

      // Send request body if present
      if (request.body) {
        req.write(request.body);
      }
      
      req.end();
    });
  }

  buildQueryString(query) {
    if (!query || Object.keys(query).length === 0) {
      return '';
    }
    
    const params = new URLSearchParams(query);
    return '?' + params.toString();
  }

  filterHeaders(headers) {
    // Remove headers that might cause issues
    const filtered = { ...headers };
    delete filtered.host;
    delete filtered.connection;
    delete filtered['content-length']; // Will be set automatically
    delete filtered['transfer-encoding'];
    return filtered;
  }

  async httpRequest(method, url, data = null, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const lib = isHttps ? https : http;
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: {
          'User-Agent': 'TunnelClient/1.0'
        },
        timeout: timeout
      };

      if (data) {
        const jsonData = JSON.stringify(data);
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(jsonData);
      }

      const req = lib.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached. Exiting...');
      process.exit(1);
    }

    this.reconnectAttempts++;
    console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    setTimeout(async () => {
      try {
        await this.connectWebSocket();
        console.log('✅ Reconnected successfully');
      } catch (error) {
        console.error('❌ Reconnection failed:', error.message);
      }
    }, this.reconnectInterval);
  }

  startPingInterval() {
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        }));
      }
    }, 30000); // Ping every 30 seconds
  }

  async cleanup() {
    console.log('🧹 Cleaning up...');
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    
    if (this.tunnelId) {
      try {
        const url = `${this.serverUrl}/api/tunnel/${this.tunnelId}`;
        await this.httpRequest('DELETE', url);
        console.log('✅ Tunnel deleted from server');
      } catch (error) {
        console.error('⚠️ Failed to delete tunnel from server:', error.message);
      }
    }
  }
}

// CLI Interface
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    serverUrl: 'https://honotunnel-production.up.railway.app',
    localPort: 3000,
    subdomain: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
      case '-p':
        options.localPort = parseInt(args[++i]);
        break;
      case '--server':
      case '-s':
        options.serverUrl = args[++i];
        break;
      case '--subdomain':
      case '-d':
        options.subdomain = args[++i];
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
🚇 Hono Tunnelmole Local Client

Usage: node local-client.js [options]

Options:
  -p, --port <number>      Local port to forward (default: 3000)
  -s, --server <url>       Tunnel server URL 
  -d, --subdomain <name>   Custom subdomain (optional)
  -h, --help              Show this help message

Examples:
  node local-client.js --port 8080
  node local-client.js --port 3000 --server https://your-tunnel.railway.app
  node local-client.js --port 8080 --subdomain myapp

Environment Variables:
  TUNNEL_SERVER   Default server URL
  TUNNEL_PORT     Default local port

Notes:
  - Make sure your local app is running on the specified port
  - Press Ctrl+C to stop the tunnel
  - Use --subdomain for easier-to-remember URLs
`);
}

// Check dependencies
try {
  require('ws');
} catch (error) {
  console.error('❌ Missing dependency: ws');
  console.log('📦 Install it with: npm install ws');
  process.exit(1);
}

// Main execution
async function main() {
  const options = parseArgs();
  
  // Override with environment variables if set
  if (process.env.TUNNEL_SERVER) {
    options.serverUrl = process.env.TUNNEL_SERVER;
  }
  if (process.env.TUNNEL_PORT) {
    options.localPort = parseInt(process.env.TUNNEL_PORT);
  }

  // Validate options
  if (!options.localPort || options.localPort < 1 || options.localPort > 65535) {
    console.error('❌ Invalid port number');
    process.exit(1);
  }

  if (!options.serverUrl) {
    console.error('❌ Server URL is required');
    process.exit(1);
  }

  const client = new TunnelClient(options);
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await client.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await client.cleanup();
    process.exit(0);
  });

  // Start the client
  await client.start();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = TunnelClient;
