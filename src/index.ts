import express, { Request, Response } from 'express';
import http from 'http';
import WebSocket from 'ws';
import { z } from 'zod';
import './ping'

// Type Definitions
interface WebSocketClient extends WebSocket {
  isAlive?: boolean;
  droplertId?: string;
  websiteUrl?: string;
}

interface NotificationPayload {
  droplertId: string;
  websites: string[];
  notification: {
    type: 'toast' | 'alert' | 'alert_dialog';
    title: string;
    message: string;
    style: string;
    backgroundColor: string;
    textColor: string;
    borderColor: string;
    imageUrl?: string;
  };
}

// Validation Schemas
const NotificationPayloadSchema = z.object({
  droplertId: z.string(),
  websites: z.array(z.string()),
  notification: z.object({
    type: z.enum(['toast', 'alert', 'alert_dialog']),
    title: z.string(),
    message: z.string(),
    style: z.string(),
    backgroundColor: z.string(),
    textColor: z.string(),
    borderColor: z.string(),
    imageUrl: z.string().optional()
  })
});

const SubscriptionMessageSchema = z.object({
  action: z.literal('subscribe'),
  droplertId: z.string(),
  websiteUrl: z.string(),
});

const VerifySubscriptionSchema = z.object({
  droplertId: z.string(),
  websiteUrl: z.string(),
});

const SetApiKeySchema = z.object({
  droplertId: z.string(),
  websiteUrl: z.string(),
});

type SubscriptionMessage = z.infer<typeof SubscriptionMessageSchema>;
type VerifySubscriptionMessage = z.infer<typeof VerifySubscriptionSchema>;
type SetApiKeyMessage = z.infer<typeof SetApiKeySchema>;


const app = express();
app.use(express.json());
app.get('/', (req, res) => {
  res.send('WebSocket server is running');
}); 

class NotificationServer {
  private readonly userChannels: Map<string, Set<WebSocketClient>> = new Map();
  private readonly apiKeys: Map<string, string> = new Map(); // apiKey -> droplertId

  constructor() {   

    // HTTP server for REST API
    const httpServer = http.createServer(app);
    const PORT = process.env.PORT || 8080;

    // WebSocket server attached to the same HTTP server
    const wsServer = new WebSocket.Server({ server: httpServer });
    wsServer.on('connection', this.handleConnection.bind(this));

    // HTTP endpoint for sending notifications
    app.post('/notify', this.handleNotification.bind(this));

    // HTTP endpoint for verifying website subscriptions

    // New HTTP endpoint for setting API key
    app.post('/set', this.setApiKey.bind(this));

    // Start the server
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Setup connection cleanup interval
    setInterval(() => this.cleanup(), 30000);
  }

  private handleConnection(ws: WebSocketClient): void {
    ws.isAlive = true;
    console.log('[WebSocket] New connection established.');

    ws.on('message', async (message: string) => {
      console.log('[WebSocket] Received message:', message);
      try {
        const data = SubscriptionMessageSchema.parse(JSON.parse(message));
        await this.handleSubscription(ws, data);
      } catch (error) {
        console.error('[WebSocket] Error parsing subscription message:', error);
        ws.send(JSON.stringify({ error: 'Invalid subscription message' }));
      }
    });

    ws.on('pong', () => {
      ws.isAlive = true;
      console.log('[WebSocket] Ping received, client is alive.');
    });

    ws.on('close', () => {
      console.log('[WebSocket] Connection closed.');
      this.removeConnection(ws);
    });
  }

  private async handleSubscription(ws: WebSocketClient, data: SubscriptionMessage): Promise<void> {
    const { droplertId, websiteUrl } = data;
  
    console.log(`[Subscription] Received subscription from ${droplertId} for website: ${websiteUrl}`);
  
    // Directly associate the WebSocket client with droplertId and websiteUrl
    ws.droplertId = droplertId;
    ws.websiteUrl = websiteUrl;
  
    // Ensure the user channel for this droplertId exists
    if (!this.userChannels.has(droplertId)) {
      this.userChannels.set(droplertId, new Set());
    }
  
    // Add the WebSocket client to the corresponding channel
    this.userChannels.get(droplertId)?.add(ws);
  
    console.log(`[Subscription] ${droplertId} successfully subscribed to notifications for ${websiteUrl}`);
    ws.send(
      JSON.stringify({
        success: true,
        message: `Subscribed to notifications for ${websiteUrl}`,
      })
    );
  }
  

  private async handleNotification(req: Request, res: Response): Promise<void> {
    try {
      const payload = NotificationPayloadSchema.parse(req.body);
      console.log('[Notification] Received notification payload:', payload);
  
      const { droplertId, websites, notification } = payload;
  
      // Retrieve the connected clients for the given droplertId
      const userClients = this.userChannels.get(droplertId);
      if (!userClients) {
        console.error('[Notification] No connected websites found for user:', droplertId);
        res.status(404).json({ error: 'No connected websites found for user' });
        return;
      }
  
      console.log(`[Notification] Sending notification to ${websites.length} websites for user ${droplertId}`);
  
      // Iterate over connected clients and send notifications
      userClients.forEach((client) => {
        if (
          client.readyState === WebSocket.OPEN &&
          client.websiteUrl &&
          websites.includes(client.websiteUrl)
        ) {
          console.log(`[Notification] Sending notification to website ${client.websiteUrl}`);
          client.send(
            JSON.stringify({
              type: 'notification',
              data: notification,
            })
          );
        }
      });
  
      res.json({ success: true, message: 'Notification sent' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('[Notification] Invalid payload format:', error.errors);
        res.status(400).json({ error: 'Invalid payload format', details: error.errors });
      } else {
        console.error('[Notification] Internal server error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
  


  private async setApiKey(req: Request, res: Response): Promise<void> {
    try {
      const apiKey = req.headers['apikey'] as string;

      if (!apiKey) {
        console.error('[Set API Key] Missing API key in headers');
        res.status(401).json({ error: 'Missing API key in headers' });
        return;
      }

      const { droplertId, websiteUrl } = SetApiKeySchema.parse(req.body);

      // Store the API key for the droplertId
      this.storeApiKey(droplertId, apiKey);

      // Add the website to the user's subscriptions
      let userClients = this.userChannels.get(droplertId);
      if (!userClients) {
        userClients = new Set();
        this.userChannels.set(droplertId, userClients);
      }

      const newClient: WebSocketClient = { droplertId, websiteUrl, isAlive: true } as WebSocketClient;
      userClients.add(newClient);

      console.log(`[Set API Key] API key set successfully for user ${droplertId} and website ${websiteUrl} added to subscriptions`);
      res.json({
        success: true,
        message: `API key set successfully for user ${droplertId} and website ${websiteUrl} added to subscriptions`
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('[Set API Key] Invalid request format:', error.errors);
        res.status(400).json({ error: 'Invalid request format', details: error.errors });
      } else {
        console.error('[Set API Key] Error setting API key:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  private removeConnection(ws: WebSocketClient): void {
    if (ws.droplertId) {
      console.log(`[Connection] Removing connection for user ${ws.droplertId}`);
      const userClients = this.userChannels.get(ws.droplertId);
      if (userClients) {
        userClients.delete(ws);
        if (userClients.size === 0) {
          this.userChannels.delete(ws.droplertId);
        }
      }
    }
  }

  private verifyApiKey(apiKey: string, droplertId: string): boolean {
    const isValid = this.apiKeys.get(droplertId) === apiKey;
    if (!isValid) {
      console.error(`[API Key] Invalid API key ${apiKey} for droplertId ${droplertId}`);
    }
    return isValid;
  }

  private storeApiKey(droplertId: string, apiKey: string): void {
    this.apiKeys.set(droplertId, apiKey);
  }

  private cleanup(): void {
    console.log('[Cleanup] Running cleanup to check for dead connections.');
  
    this.userChannels.forEach((clients, droplertId) => {
      clients.forEach((client) => {
        if (!client.isAlive) {
          console.log(`[Cleanup] Removing dead connection for ${droplertId}`);
          this.removeConnection(client);
          return;
        }
        
        // Only call ping if the client is a WebSocket instance
        if (client instanceof WebSocket) {
          client.isAlive = false;
          client.ping(); // Ping to check if client is alive
        } else {
          console.error('[Cleanup] Client is not a WebSocket instance');
        }
      });
    });
  }
  
}

// Start the server
new NotificationServer();

