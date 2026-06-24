import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('FATAL: ENCRYPTION_KEY is missing from environment variables.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(text) {
  if (!text) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

export function decryptToken(encryptedText) {
  if (!encryptedText) return null;
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    return encryptedText;
  }
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('[ClapClip Security] Failed to decrypt token:', e);
    return encryptedText;
  }
}

function isEncrypted(token) {
  return token && token.split(':').length === 3;
}


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../clipper.db');

let db = null;

/**
 * Open SQLite database and enable foreign keys.
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.run("PRAGMA foreign_keys = ON;", (err) => {
        if (err) return reject(err);
        resolve(db);
      });
    });
  });
}

/**
 * Promise wrapper to execute SQL statement (INSERT, UPDATE, DELETE).
 */
export function runQuery(sql, params = []) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await openDb();
      database.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve(this); // returns 'lastID' and 'changes' properties
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Promise wrapper to retrieve all matching rows for SQL query.
 */
export function allQuery(sql, params = []) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await openDb();
      database.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Promise wrapper to retrieve single row for SQL query.
 */
export function getQuery(sql, params = []) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await openDb();
      database.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Creates channels, playlists, and uploads tables.
 */
export async function initDatabase() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS channels (
      channel_id TEXT PRIMARY KEY,
      channel_name TEXT,
      channel_avatar TEXT,
      client_id TEXT,
      client_secret TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      status TEXT DEFAULT 'connected',
      created_at INTEGER
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS playlists (
      playlist_id TEXT PRIMARY KEY,
      channel_id TEXT,
      title TEXT,
      synced_at INTEGER,
      FOREIGN KEY(channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT,
      title TEXT,
      start_time REAL,
      end_time REAL,
      playlist_id TEXT,
      channel_id TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      youtube_video_id TEXT,
      created_at INTEGER,
      FOREIGN KEY(channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE
    )
  `);
}

/**
 * Save a newly authorized channel credentials or update an existing record.
 */
export async function saveChannel(channel) {
  const { channelId, channelName, channelAvatar, clientId, clientSecret, accessToken, refreshToken, expiresAt } = channel;
  const now = Date.now();
  
  const existing = await getQuery("SELECT * FROM channels WHERE channel_id = ?", [channelId]);
  
  let finalRefreshToken = refreshToken;
  if (refreshToken && !isEncrypted(refreshToken)) {
    finalRefreshToken = encryptToken(refreshToken);
  } else if (!refreshToken && existing) {
    finalRefreshToken = existing.refresh_token;
  }

  if (existing) {
    await runQuery(`
      UPDATE channels 
      SET channel_name = ?, channel_avatar = ?, client_id = ?, client_secret = ?, access_token = ?, refresh_token = ?, expires_at = ?, status = 'connected'
      WHERE channel_id = ?
    `, [channelName, channelAvatar, clientId, clientSecret, accessToken, finalRefreshToken, expiresAt, channelId]);
  } else {
    await runQuery(`
      INSERT INTO channels (channel_id, channel_name, channel_avatar, client_id, client_secret, access_token, refresh_token, expires_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?)
    `, [channelId, channelName, channelAvatar, clientId, clientSecret, accessToken, finalRefreshToken, expiresAt, now]);
  }
}

/**
 * Retrieve public metadata of all connected channels.
 */
export async function getChannels() {
  return allQuery(`
    SELECT channel_id as channelId, channel_name as channelName, channel_avatar as channelAvatar, expires_at as expiresAt, status 
    FROM channels
    ORDER BY created_at DESC
  `);
}

/**
 * Retrieve full credentials for a specific channel.
 */
export async function getChannelCredentials(channelId) {
  const creds = await getQuery("SELECT * FROM channels WHERE channel_id = ?", [channelId]);
  if (creds && creds.refresh_token) {
    creds.refresh_token = decryptToken(creds.refresh_token);
  }
  return creds;
}

/**
 * Update active access tokens.
 */
export async function updateChannelTokens(channelId, accessToken, expiresAt) {
  await runQuery(`
    UPDATE channels 
    SET access_token = ?, expires_at = ?, status = 'connected'
    WHERE channel_id = ?
  `, [accessToken, expiresAt, channelId]);
}

/**
 * Set channel authorization status.
 */
export async function setChannelStatus(channelId, status) {
  await runQuery(`
    UPDATE channels 
    SET status = ?
    WHERE channel_id = ?
  `, [status, channelId]);
}

/**
 * Dissociate and delete channel credentials.
 */
export async function deleteChannel(channelId) {
  await runQuery("DELETE FROM channels WHERE channel_id = ?", [channelId]);
}

/**
 * Retrieve cached playlists.
 */
export async function getCachedPlaylists(channelId) {
  return allQuery("SELECT playlist_id as id, title FROM playlists WHERE channel_id = ?", [channelId]);
}

/**
 * Cache playlists locally in the database.
 */
export async function savePlaylists(channelId, playlists) {
  await runQuery("DELETE FROM playlists WHERE channel_id = ?", [channelId]);
  
  const now = Date.now();
  for (const playlist of playlists) {
    await runQuery(`
      INSERT OR REPLACE INTO playlists (playlist_id, channel_id, title, synced_at)
      VALUES (?, ?, ?, ?)
    `, [playlist.id, channelId, playlist.title, now]);
  }
}

/**
 * Create a new pending upload log metrics record.
 */
export async function createUploadLog(videoData) {
  const { videoId, title, startTime, endTime, playlistId, channelId } = videoData;
  const now = Date.now();
  const result = await runQuery(`
    INSERT INTO uploads (video_id, title, start_time, end_time, playlist_id, channel_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `, [videoId, title, startTime, endTime, playlistId, channelId, now]);
  return result.lastID;
}

/**
 * Update upload log details and completion statuses.
 */
export async function updateUploadLog(id, status, details = {}) {
  const { errorMessage, youtubeVideoId } = details;
  if (status === 'completed') {
    await runQuery(`
      UPDATE uploads 
      SET status = ?, youtube_video_id = ?
      WHERE id = ?
    `, [status, youtubeVideoId, id]);
  } else if (status === 'failed') {
    await runQuery(`
      UPDATE uploads 
      SET status = ?, error_message = ?
      WHERE id = ?
    `, [status, errorMessage, id]);
  } else {
    await runQuery(`
      UPDATE uploads 
      SET status = ?
      WHERE id = ?
    `, [status, id]);
  }
}

/**
 * Retrieve full upload metrics log records.
 */
export async function getUploadLogs() {
  return allQuery(`
    SELECT u.id, u.video_id as videoId, u.title, u.start_time as startTime, u.end_time as endTime, 
           u.playlist_id as playlistId, u.channel_id as channelId, u.status, u.error_message as errorMessage, 
           u.youtube_video_id as youtubeVideoId, u.created_at as createdAt,
           c.channel_name as channelName, p.title as playlistTitle
    FROM uploads u
    LEFT JOIN channels c ON u.channel_id = c.channel_id
    LEFT JOIN playlists p ON u.playlist_id = p.playlist_id
    ORDER BY u.created_at DESC
  `);
}
