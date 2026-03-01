import express from "express";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { Client } from "pg";
import snowflake from "snowflake-sdk";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- OAuth Endpoints ---
  // These endpoints initiate the OAuth flow for various providers.
  // They accept a clientId query parameter, falling back to environment variables.
  // In a real app, these would use actual Client IDs and Secrets to generate OAuth URLs

  // Slack OAuth
  app.get("/api/auth/slack/url", (req, res) => {
    const clientId = req.query.clientId as string || process.env.SLACK_CLIENT_ID || 'YOUR_SLACK_CLIENT_ID';
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/slack/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'channels:read,chat:write',
      redirect_uri: redirectUri,
      response_type: 'code',
    });
    const url = `https://slack.com/oauth/v2/authorize?${params}`;
    res.json({ url });
  });

  app.get("/auth/slack/callback", (req, res) => {
    // Token exchange would happen here in a real implementation
    // const { code } = req.query;
    // const tokens = await exchangeCodeForTokens(code);
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'slack' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Slack Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  });

  // Stripe OAuth
  app.get("/api/auth/stripe/url", (req, res) => {
    const clientId = req.query.clientId as string || process.env.STRIPE_CLIENT_ID || 'YOUR_STRIPE_CLIENT_ID';
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/stripe/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'read_write',
      redirect_uri: redirectUri,
    });
    const url = `https://connect.stripe.com/oauth/authorize?${params}`;
    res.json({ url });
  });

  app.get("/auth/stripe/callback", (req, res) => {
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'stripe' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Stripe Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  });

  // Confluence OAuth
  app.get("/api/auth/confluence/url", (req, res) => {
    const clientId = req.query.clientId as string || process.env.CONFLUENCE_CLIENT_ID || 'YOUR_CONFLUENCE_CLIENT_ID';
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/confluence/callback`;
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: clientId,
      scope: 'read:confluence-content.summary',
      redirect_uri: redirectUri,
      response_type: 'code',
      prompt: 'consent'
    });
    const url = `https://auth.atlassian.com/authorize?${params}`;
    res.json({ url });
  });

  app.get("/auth/confluence/callback", (req, res) => {
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'confluence' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Confluence Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  });

  // --- Zendesk Proxy Endpoints ---
  // Proxies requests to Zendesk API to avoid CORS issues
  app.post("/api/zendesk/search", async (req, res) => {
    const { subdomain, email, token, query } = req.body;
    if (!subdomain || !email || !token || !query) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    const auth = Buffer.from(`${email}/token:${token}`).toString('base64');
    try {
      const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Basic ${auth}` }
      });
      const data = await response.json();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/zendesk/ticket", async (req, res) => {
    const { subdomain, email, token, ticket_id } = req.body;
    if (!subdomain || !email || !token || !ticket_id) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    const auth = Buffer.from(`${email}/token:${token}`).toString('base64');
    try {
      const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/${ticket_id}/comments.json`, {
        headers: { 'Authorization': `Basic ${auth}` }
      });
      const data = await response.json();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/zendesk/update", async (req, res) => {
    const { subdomain, email, token, ticket_id, comment, status } = req.body;
    if (!subdomain || !email || !token || !ticket_id) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    const auth = Buffer.from(`${email}/token:${token}`).toString('base64');
    const payload: any = { ticket: {} };
    if (comment) payload.ticket.comment = { body: comment };
    if (status) payload.ticket.status = status;

    try {
      const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/${ticket_id}.json`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Database Proxy Endpoints ---
  app.post("/api/postgres/query", async (req, res) => {
    const { connectionString, query } = req.body;
    if (!connectionString || !query) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    try {
      const client = new Client({ connectionString });
      await client.connect();
      const result = await client.query(query);
      await client.end();
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/snowflake/query", async (req, res) => {
    const { account, username, password, database, schema, warehouse, query } = req.body;
    if (!account || !username || !password || !query) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    try {
      const connection = snowflake.createConnection({
        account,
        username,
        password,
        database,
        schema,
        warehouse
      });
      
      connection.connect((err, conn) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        connection.execute({
          sqlText: query,
          complete: (err, stmt, rows) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json(rows);
          }
        });
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static('dist'));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
