import { defineConfig, loadEnv } from 'vite';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';
import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lookupPromise = promisify(dns.lookup);

// SSRF IP checks
async function isPrivateIP(hostname) {
  try {
    const { address } = await lookupPromise(hostname);
    const parts = address.split('.').map(Number);
    if (parts.length === 4) {
      // 127.0.0.0/8
      if (parts[0] === 127 || parts[0] === 10) return true;
      // 172.16.0.0/12
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 169.254.0.0/16
      if (parts[0] === 169 && parts[1] === 254) return true;
    }
    return false;
  } catch (e) {
    return true; // Block on lookup failures
  }
}

// Helper to recursively download a file (handles HTTP redirects & security validations)
function downloadFile(urlStr, dest) {
  return new Promise(async (resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      if (parsedUrl.protocol !== 'https:') {
        reject(new Error('SSRF Protection: Only HTTPS protocol is allowed'));
        return;
      }

      // Restrict domain to GitHub release hosts
      const allowedHostSuffixes = ['github.com', 'githubusercontent.com', 'amazonaws.com'];
      const isAllowedHost = allowedHostSuffixes.some(suffix =>
        parsedUrl.hostname === suffix || parsedUrl.hostname.endsWith('.' + suffix)
      );

      if (!isAllowedHost) {
        reject(new Error(`Security Allowlist Validation: Domain ${parsedUrl.hostname} is not allowed`));
        return;
      }

      if (await isPrivateIP(parsedUrl.hostname)) {
        reject(new Error('SSRF Protection: Access to private network range is blocked'));
        return;
      }

      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const file = fs.createWriteStream(dest);

      const request = https.get(urlStr, (response) => {
        // Handle redirect status codes (3xx)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlink(dest, () => { }); // Clean up temp stream file
          // Follow redirect recursively
          downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => { });
          reject(new Error(`Failed to download: server returned status code ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            resolve();
          });
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlink(dest, () => { });
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// YouTube Video ID regex format validation
function validateVideoId(v) {
  return typeof v === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(v);
}

// Cookie parser utility
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}

// Session authorization token
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex');

function requireAuth(req, res, next, env) {
  const authHeader = req.headers.authorization;
  if (authHeader && env.API_SECRET) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === env.API_SECRET) {
      return next();
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.session_token === SESSION_TOKEN) {
    return next();
  }

  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Unauthorized: Session invalid or missing' }));
}

// API Rate Limiter
const rateLimitDb = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_LIMIT = 100;

function rateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let clientRecord = rateLimitDb.get(ip);
  if (!clientRecord) {
    clientRecord = { count: 0, resetTime: now + WINDOW_MS };
    rateLimitDb.set(ip, clientRecord);
  }

  if (now > clientRecord.resetTime) {
    clientRecord.count = 0;
    clientRecord.resetTime = now + WINDOW_MS;
  }

  clientRecord.count += 1;
  const remaining = Math.max(0, MAX_LIMIT - clientRecord.count);
  const resetSeconds = Math.ceil((clientRecord.resetTime - now) / 1000);

  res.setHeader('X-RateLimit-Limit', MAX_LIMIT.toString());
  res.setHeader('X-RateLimit-Remaining', remaining.toString());
  res.setHeader('X-RateLimit-Reset', resetSeconds.toString());

  if (clientRecord.count > MAX_LIMIT) {
    logAuditEvent('rate_limit_exceeded', { ip, url: req.url, count: clientRecord.count });
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Too many requests, please try again later.' }));
    return;
  }
  next();
}

// Upload concurrency queue
let activeUploads = 0;
const MAX_CONCURRENT_UPLOADS = 2;
const MAX_QUEUE_SIZE = 10;
const uploadQueue = [];

function processUploadQueue() {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS || uploadQueue.length === 0) {
    return;
  }
  const nextJob = uploadQueue.shift();
  activeUploads++;
  nextJob();
}


// Ensure yt-dlp binary is present for the active OS
async function ensureYtdlpBinary() {
  const binDir = path.join(__dirname, 'bin');
  let binName = 'yt-dlp';
  let downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  if (process.platform === 'win32') {
    binName = 'yt-dlp.exe';
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (process.platform === 'darwin') {
    binName = 'yt-dlp_macos';
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  }

  const binPath = path.join(binDir, binName);

  if (fs.existsSync(binPath)) {
    return binPath;
  }

  console.log(`[ClapClip Dev Server] Binary yt-dlp not found. Downloading for platform: ${process.platform}...`);
  await downloadFile(downloadUrl, binPath);

  // Set executable permissions on Unix systems
  if (process.platform !== 'win32') {
    fs.chmodSync(binPath, 0o755);
  }

  console.log(`[ClapClip Dev Server] yt-dlp binary configured at: ${binPath}`);
  return binPath;
}

import * as db from './src/db.js';
import { logAuditEvent } from './src/auditLogger.js';

// Helper to refresh Google OAuth2 Access Token if expired
async function getValidAccessTokenForChannel(channelId) {
  const creds = await db.getChannelCredentials(channelId);
  if (!creds) {
    throw new Error(`Channel credentials not found in database for ID: ${channelId}`);
  }

  const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, client_id: clientId, client_secret: clientSecret } = creds;

  // If token is still valid (not expiring in next 2 minutes), return it
  if (expiresAt && Date.now() < (expiresAt - 120000)) {
    return accessToken;
  }

  console.log(`[ClapClip Dev Server] Access token for channel ${channelId} expired or expiring soon, refreshing...`);

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!refreshRes.ok) {
    const errorText = await refreshRes.text();
    await db.setChannelStatus(channelId, 'expired');
    throw new Error(`Failed to refresh access token: ${errorText}`);
  }

  const data = await refreshRes.json();
  const newAccessToken = data.access_token;
  const newExpiresAt = Date.now() + (data.expires_in * 1000);

  await db.updateChannelTokens(channelId, newAccessToken, newExpiresAt);
  return newAccessToken;
}

// Sync Playlists from YouTube API and save to database
async function syncChannelPlaylists(channelId) {
  const accessToken = await getValidAccessTokenForChannel(channelId);

  const playlistsRes = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!playlistsRes.ok) {
    const errText = await playlistsRes.text();
    throw new Error(`Failed to load playlists from YouTube: ${errText}`);
  }

  const playlistData = await playlistsRes.json();
  const items = playlistData.items || [];
  const playlists = items.map(p => ({
    id: p.id,
    title: p.snippet.title
  }));

  await db.savePlaylists(channelId, playlists);
  return playlists;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, val] of Object.entries(env)) {
    process.env[key] = val;
  }

  return {
    server: {
      host: "0.0.0.0",
      port: Number(process.env.PORT) || 5173,
      strictPort: false
    },
    plugins: [
      {
        name: 'youtube-downloader-api',
        configureServer(server) {
          if (!env.ENCRYPTION_KEY) {
            console.error('\n[ClapClip Dev Server] FATAL ERROR: ENCRYPTION_KEY is missing in your environment configuration (.env).\n');
            process.exit(1);
          }

          // Initialize DB tables on startup
          db.initDatabase()
            .then(() => console.log('[ClapClip Dev Server] SQLite database initialized successfully.'))
            .catch(err => console.error('[ClapClip Dev Server] SQLite database initialization failed:', err));

          // Security Middleware 0: Global Security Headers
          server.middlewares.use((req, res, next) => {
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Referrer-Policy', 'no-referrer');

            const csp = [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com",
              "child-src https://www.youtube.com",
              "frame-src https://www.youtube.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https://img.youtube.com https://i.ytimg.com https://yt3.ggpht.com https://via.placeholder.com",
              "connect-src 'self' ws: wss:"
            ].join('; ');
            res.setHeader('Content-Security-Policy', csp);

            // Strict-Transport-Security when HTTPS is enabled / production environment
            const isHttps = req.connection?.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
            if (isHttps) {
              res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
            }
            next();
          });

          // Security Middleware 1: Set Session Cookie on index load
          server.middlewares.use((req, res, next) => {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            if (url.pathname === '/' || url.pathname === '/index.html') {
              const cookies = parseCookies(req.headers.cookie);
              if (!cookies.session_token || cookies.session_token !== SESSION_TOKEN) {
                const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
                res.setHeader('Set-Cookie', `session_token=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Strict${secureFlag}`);
              }
            }
            next();
          });

          // Security Middleware 2: Rate Limiting
          server.middlewares.use((req, res, next) => {
            if (req.url.startsWith('/api/')) {
              return rateLimiter(req, res, next);
            }
            next();
          });

          // Security Middleware 3: RequireAuth on private routes
          server.middlewares.use((req, res, next) => {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const privateRoutes = [
              '/api/channels',
              '/api/playlists',
              '/api/uploads',
              '/api/upload-youtube',
              '/api/download'
            ];
            const isPrivate = privateRoutes.some(route => url.pathname === route || url.pathname.startsWith(route + '/'));
            if (isPrivate) {
              return requireAuth(req, res, next, env);
            }
            next();
          });

          // GET /api/health: Health check endpoint
          server.middlewares.use('/api/health', (req, res, next) => {
            if (req.method === 'GET' && (req.url === '/' || req.url === '' || req.url.startsWith('/?'))) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
              return;
            }
            next();
          });

          // 0. GET /api/config: Return environment credentials configuration status
          server.middlewares.use('/api/config', (req, res, next) => {
            if (req.method === 'GET' && (req.url === '/' || req.url === '' || req.url.startsWith('/?'))) {
              const hasEnv = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ hasEnvCredentials: hasEnv }));
              return;
            }
            next();
          });

          // 1. GET /api/auth: Initiate Google OAuth consent page redirect
          server.middlewares.use('/api/auth', (req, res, next) => {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const clientId = urlParams.get('clientId') || env.GOOGLE_CLIENT_ID;
            const clientSecret = urlParams.get('clientSecret') || env.GOOGLE_CLIENT_SECRET;

            if (!clientId || !clientSecret) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'text/plain');
              res.end('Missing Google Developer Client ID or Client Secret (Server-side .env is not configured and no client credentials were provided)');
              return;
            }

            // Encode secrets into state param to receive them back in callback (stateless oauth)
            const state = Buffer.from(JSON.stringify({ clientId, clientSecret })).toString('base64');
            const redirectUri = `https://clapclip-production.up.railway.app/api/callback`;

            const scopes = [
              'https://www.googleapis.com/auth/youtube.upload',
              'https://www.googleapis.com/auth/youtube.readonly',
              'https://www.googleapis.com/auth/youtube'
            ].join(' ');

            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
              `client_id=${clientId}` +
              `&redirect_uri=${encodeURIComponent(redirectUri)}` +
              `&response_type=code` +
              `&scope=${encodeURIComponent(scopes)}` +
              `&access_type=offline` +
              `&prompt=consent` +
              `&state=${state}`;

            res.writeHead(302, { Location: authUrl });
            res.end();
          });

          // 2. GET /api/callback: Handle Google OAuth Redirect Callback
          server.middlewares.use('/api/callback', async (req, res, next) => {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const code = urlParams.get('code');
            const stateBase64 = urlParams.get('state');

            if (!code || !stateBase64) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'text/html');
              res.end('<h3>Authentication aborted or missing code parameter</h3>');
              return;
            }

            try {
              // Retrieve client credentials from state
              let clientId = '';
              let clientSecret = '';
              try {
                const parsedState = JSON.parse(Buffer.from(stateBase64, 'base64').toString('utf-8'));
                clientId = parsedState.clientId;
                clientSecret = parsedState.clientSecret;
              } catch (e) {
                // Ignore parse errors if we are falling back to server-side credentials
              }

              // Fallback to server env credentials if not provided in state
              if (!clientId || !clientSecret) {
                clientId = env.GOOGLE_CLIENT_ID;
                clientSecret = env.GOOGLE_CLIENT_SECRET;
              }

              if (!clientId || !clientSecret) {
                throw new Error('Google OAuth credentials not found (missing client ID or client secret)');
              }

              const redirectUri = `https://clapclip-production.up.railway.app/api/callback`;

              // Exchange authorization code for token
              const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  code,
                  client_id: clientId,
                  client_secret: clientSecret,
                  redirect_uri: redirectUri,
                  grant_type: 'authorization_code'
                })
              });

              if (!tokenRes.ok) {
                const errText = await tokenRes.text();
                throw new Error(`Token exchange failed: ${errText}`);
              }

              const tokenData = await tokenRes.json();

              // Fetch authenticated user channel info
              const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
              });

              if (!channelRes.ok) {
                throw new Error('Failed to fetch channel details');
              }

              const channelData = await channelRes.json();
              const channelItem = channelData.items && channelData.items[0];
              const channelName = channelItem ? channelItem.snippet.title : 'YouTube Channel';
              const channelAvatar = channelItem ? channelItem.snippet.thumbnails.default.url : '';
              const channelId = channelItem ? channelItem.id : '';

              // Save credentials to SQLite
              await db.saveChannel({
                channelId,
                channelName,
                channelAvatar,
                clientId,
                clientSecret,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiresAt: Date.now() + (tokenData.expires_in * 1000)
              });

              logAuditEvent('login_success', { channelId, channelName });
              logAuditEvent('channel_connected', { channelId, channelName });

              // Only return safe public channel info to the client
              const publicPayload = {
                channelId,
                channelName,
                channelAvatar,
                status: 'connected'
              };

              // Return script to send credentials to the parent window and close popup
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>Authentication Complete</title></head>
                <body style="font-family: sans-serif; background: #060913; color: white; text-align: center; padding-top: 50px;">
                  <h2>Authentication Successful!</h2>
                  <p>Transferring credentials back to ClapClip app...</p>
                  <script>
                    if (window.opener) {
                      window.opener.postMessage({ type: 'YOUTUBE_AUTH_SUCCESS', data: ${JSON.stringify(publicPayload)} }, window.location.origin);
                      window.close();
                    } else {
                      document.body.innerHTML = '<h2>Done! You can close this window now.</h2>';
                    }
                  </script>
                </body>
                </html>
              `);

            } catch (err) {
              console.error('[ClapClip OAuth Callback Error]:', err);
              logAuditEvent('login_failure', { error: err.message });
              res.statusCode = 500;
              res.setHeader('Content-Type', 'text/html');
              res.end(`<h3>Internal Server Error</h3><p>${err.message}</p>`);
            }
          });

          // 3. GET/DELETE /api/channels: Channel retrieval/deletion APIs
          server.middlewares.use('/api/channels', async (req, res, next) => {
            if (req.method === 'GET' && (req.url === '/' || req.url === '' || req.url.startsWith('/?'))) {
              try {
                const channels = await db.getChannels();
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(channels));
              } catch (err) {
                console.error('[ClapClip Channels GET Error]:', err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              }
              return;
            }

            if (req.method === 'POST' && (req.url === '/delete' || req.url.startsWith('/delete?'))) {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  const { channelId } = JSON.parse(body);
                  if (!channelId) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Missing channelId' }));
                    return;
                  }
                  await db.deleteChannel(channelId);
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ success: true }));
                } catch (err) {
                  console.error('[ClapClip Channel DELETE Error]:', err);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }
            next();
          });

          // 4. POST /api/playlists: Fetch user playlists cached, or force sync
          server.middlewares.use('/api/playlists', async (req, res, next) => {
            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  const { channelId } = JSON.parse(body);
                  if (!channelId) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Missing channelId' }));
                    return;
                  }

                  if (req.url === '/sync' || req.url.startsWith('/sync?')) {
                    const playlists = await syncChannelPlaylists(channelId);
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ playlists }));
                  } else {
                    let playlists = await db.getCachedPlaylists(channelId);
                    if (playlists.length === 0) {
                      playlists = await syncChannelPlaylists(channelId);
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ playlists }));
                  }
                } catch (err) {
                  console.error('[ClapClip Playlists Error]:', err);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }
            next();
          });

          // 5. GET /api/uploads: Fetch upload log history metrics
          server.middlewares.use('/api/uploads', async (req, res, next) => {
            if (req.method === 'GET' && (req.url === '/' || req.url === '' || req.url.startsWith('/?'))) {
              try {
                const logs = await db.getUploadLogs();
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(logs));
              } catch (err) {
                console.error('[ClapClip Upload Logs Error]:', err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              }
              return;
            }
            next();
          });

          // 6. POST /api/upload-youtube: Download clip, upload to YouTube and assign to playlist
          server.middlewares.use('/api/upload-youtube', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end('Method Not Allowed');
              return;
            }

            if (uploadQueue.length >= MAX_QUEUE_SIZE) {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Upload queue is full. Please try again later.' }));
              return;
            }

            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              const runJob = async () => {
                let child = null;
                let outputPath = null;
                let logId = null;

                try {
                  const payload = JSON.parse(body);
                  const { v, start, end, title, description, playlistId, channelId } = payload;

                  if (!v || !channelId) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Missing parameter v or channelId' }));
                    return;
                  }

                  if (!validateVideoId(v)) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Invalid YouTube video ID format' }));
                    return;
                  }

                  // Create database metrics record log
                  logId = await db.createUploadLog({ videoId: v, title, startTime: start, endTime: end, playlistId, channelId });
                  console.log(
                    '[UPLOAD LOG CREATED]',
                    logId,
                    v,
                    title
                  );
                  await db.updateUploadLog(logId, 'uploading');

                  // A. Get fresh token
                  const accessToken = await getValidAccessTokenForChannel(channelId);

                  // B. Clip video locally using yt-dlp & ffmpeg
                  const ytdlpPath = await ensureYtdlpBinary();
                  const tempDir = path.join(__dirname, 'temp');
                  if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                  }

                  const safeTitle = title.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
                  const timestamp = Date.now();

                  const sourcePath = path.join(
                    tempDir,
                    `source_${safeTitle}_${timestamp}.mp4`
                  );

                  outputPath = path.join(
                    tempDir,
                    `clip_${safeTitle}_${timestamp}.mp4`
                  );
                  const ytdlpArgs = [
                    '--ffmpeg-location', ffmpegPath,
                    '--js-runtimes', 'node',
                    '-f', '18',
                    `https://www.youtube.com/watch?v=${v}`,
                    '-o', sourcePath
                  ];
                  console.log(`[ClapClip Dev Server] Clipping for upload: v=${v}, range=${start}-${end}`);

                  child = spawn(ytdlpPath, ytdlpArgs);

                  let stderrLog = '';
                  child.stderr.on('data', (data) => {
                    stderrLog += data.toString();
                  });

                  // Promise wrapper for child process
                  await new Promise((resolve, reject) => {
                    child.on('close', (code) => {
                      if (code !== 0) {
                        reject(new Error(`yt-dlp failed: ${stderrLog}`));
                      } else {
                        resolve();
                      }
                    });
                    req.on('close', () => {
                      if (child && !child.killed) child.kill();
                    });
                  });
                  await new Promise((resolve, reject) => {
                    const ffmpegArgs = [
                      '-y',
                      '-ss', String(start),
                      '-to', String(end),
                      '-i', sourcePath,
                      '-c:v', 'libx264',
                      '-c:a', 'aac',
                      outputPath
                    ];

                    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

                    let ffmpegErrors = '';

                    ffmpegProcess.stderr.on('data', (data) => {
                      ffmpegErrors += data.toString();
                    });

                    ffmpegProcess.on('close', (code) => {
                      if (code !== 0) {
                        reject(new Error(`ffmpeg trim failed: ${ffmpegErrors}`));
                      } else {
                        resolve();
                      }
                    });
                  });
                  if (!fs.existsSync(outputPath)) {
                    throw new Error('Clipping complete but output file not found on server');
                  }

                  // C. Upload file to YouTube via multipart related API
                  console.log(`[ClapClip Dev Server] Uploading file to YouTube: ${outputPath}`);
                  console.log('SOURCE FILE:', sourcePath);
                  console.log('CLIP FILE:', outputPath);

                  const sourceStat = fs.statSync(sourcePath);
                  const clipStat = fs.statSync(outputPath);

                  console.log('SOURCE SIZE:', sourceStat.size);
                  console.log('CLIP SIZE:', clipStat.size);
                  const fileBuffer = fs.readFileSync(outputPath);
                  const boundary = '-------314159265358979323846';

                  const metadata = {
                    snippet: {
                      title: title,
                      description: description || 'Clipped using ClapClip App',
                      categoryId: '22'
                    },
                    status: {
                      privacyStatus: 'public',
                      selfDeclaredMadeForKids: false
                    }
                  };

                  const headerPart =
                    `--${boundary}\r\n` +
                    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                    JSON.stringify(metadata) + `\r\n`;

                  const mediaPartHeader =
                    `--${boundary}\r\n` +
                    `Content-Type: video/mp4\r\n\r\n`;

                  const footerPart = `\r\n--${boundary}--`;

                  const bodyBuffer = Buffer.concat([
                    Buffer.from(headerPart, 'utf-8'),
                    Buffer.from(mediaPartHeader, 'utf-8'),
                    fileBuffer,
                    Buffer.from(footerPart, 'utf-8')
                  ]);

                  const uploadRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Content-Type': `multipart/related; boundary=${boundary}`,
                      'Content-Length': bodyBuffer.length.toString()
                    },
                    body: bodyBuffer
                  });

                  if (!uploadRes.ok) {
                    const errText = await uploadRes.text();
                    throw new Error(`YouTube Upload API failed: ${errText}`);
                  }

                  const uploadData = await uploadRes.json();
                  const newVideoId = uploadData.id;
                  console.log(`[ClapClip Dev Server] Uploaded successfully: videoId = ${newVideoId}`);
                  try {
                    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                  } catch (err) {
                    console.warn('Temp file cleanup failed:', err.message);
                  }
                  // D. Add uploaded video to playlist (if playlist selected)
                  if (playlistId) {
                    console.log(`[ClapClip Dev Server] Assigning video ${newVideoId} to playlist ${playlistId}`);
                    const playlistItemRes = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        snippet: {
                          playlistId: playlistId,
                          resourceId: {
                            kind: 'youtube#video',
                            videoId: newVideoId
                          }
                        }
                      })
                    });

                    if (!playlistItemRes.ok) {
                      const errText = await playlistItemRes.text();
                      console.error(`[ClapClip Dev Server] Playlist assignment failed: ${errText}`);
                      logAuditEvent('playlist_assignment', { status: 'failed', videoId: newVideoId, playlistId, error: errText });
                    } else {
                      console.log(`[ClapClip Dev Server] Added video to playlist successfully.`);
                      logAuditEvent('playlist_assignment', { status: 'success', videoId: newVideoId, playlistId });
                    }
                  }

                  // Update upload log state
                  await db.updateUploadLog(logId, 'completed', { youtubeVideoId: newVideoId });
                  logAuditEvent('upload_completed', { videoId: v, youtubeVideoId: newVideoId, channelId });

                  // E. Clean up local file
                  fs.unlink(outputPath, (err) => {
                    if (err) console.error('[ClapClip Dev Server] Error deleting upload file:', err);
                  });

                  // F. Respond back
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({
                    success: true,
                    videoId: newVideoId,
                    youtubeUrl: `https://www.youtube.com/watch?v=${newVideoId}`
                  }));

                } catch (err) {
                  console.error('[ClapClip Upload Server Error]:', err);

                  if (outputPath && fs.existsSync(outputPath)) {
                    fs.unlink(outputPath, () => { });
                  }
                  if (logId) {
                    await db.updateUploadLog(logId, 'failed', { errorMessage: err.message });
                  }
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: err.message }));
                } finally {
                  activeUploads--;
                  processUploadQueue();
                }
              };

              uploadQueue.push(runJob);
              processUploadQueue();
            });
          });

          // 7. GET /api/download: Stream local file download
          server.middlewares.use('/api/download', async (req, res) => {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const videoId = urlParams.get('v');
            const start = parseFloat(urlParams.get('start') || '0');
            const end = parseFloat(urlParams.get('end') || '0');
            const title = urlParams.get('title') || 'clip';

            if (!videoId) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing parameter v (video ID)' }));
              return;
            }

            if (!validateVideoId(videoId)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid YouTube video ID format' }));
              return;
            }

            if (start < 0 || end <= start) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid start/end parameters' }));
              return;
            }

            try {
              const ytdlpPath = await ensureYtdlpBinary();
              const tempDir = path.join(__dirname, 'temp');
              if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
              }

              const safeTitle = title.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
              const outputFilename = `clip_${safeTitle}_${Date.now()}.mp4`;
              const outputPath = path.join(tempDir, outputFilename);

              const ytdlpArgs = [
                '--ffmpeg-location', ffmpegPath,
                '--js-runtimes', 'node',
                '-f', '18',
                `https://www.youtube.com/watch?v=${videoId}`,
                '-o', outputPath
              ];

              console.log(`[ClapClip Dev Server] Starting download: v=${videoId}, start=${start}s, end=${end}s`);

              const child = spawn(ytdlpPath, ytdlpArgs);

              let stderrLog = '';
              child.stderr.on('data', (data) => {
                stderrLog += data.toString();
              });

              child.on('close', (code) => {
                if (code !== 0) {
                  console.error(`[ClapClip Dev Server] yt-dlp failed with exit code ${code}`);
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Failed to download and trim video clip', details: stderrLog }));
                  return;
                }

                if (!fs.existsSync(outputPath)) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Trimmed video file was not found on server' }));
                  return;
                }

                res.statusCode = 200;
                res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
                res.setHeader('Content-Type', 'video/mp4');

                const fileStream = fs.createReadStream(outputPath);
                fileStream.pipe(res);

                res.on('finish', () => {
                  fs.unlink(outputPath, (err) => {
                    if (err) console.error('[ClapClip Dev Server] Error deleting temp file:', err);
                  });
                });
              });

              req.on('close', () => {
                if (child && !child.killed) {
                  child.kill();
                }
              });

            } catch (error) {
              console.error('[ClapClip Dev Server] Internal error:', error);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Internal server error', details: error.message }));
            }
          });
        }
      }
    ]
  };
});
