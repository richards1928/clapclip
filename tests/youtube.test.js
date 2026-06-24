import * as db from '../src/db.js';
import assert from 'assert';

async function runTests() {
  console.log('--- Starting SQLite Database Tests ---');
  
  // 1. Init Database
  await db.initDatabase();
  console.log('✓ Database tables created successfully.');
  
  // 2. Clear channels (for test isolation)
  await db.runQuery("DELETE FROM channels");
  // Cascades should clean uploads & playlists but let's clear them explicitly just in case
  await db.runQuery("DELETE FROM uploads");
  await db.runQuery("DELETE FROM playlists");
  
  // 3. Test saveChannel & getChannels
  const testChannel = {
    channelId: 'UC123456789',
    channelName: 'Test Creator',
    channelAvatar: 'https://avatar.url',
    clientId: 'client_id_secret',
    clientSecret: 'client_secret_secret',
    accessToken: 'access_123',
    refreshToken: 'refresh_123',
    expiresAt: Date.now() + 3600000
  };
  
  await db.saveChannel(testChannel);
  console.log('✓ saveChannel succeeded.');
  
  const channels = await db.getChannels();
  assert.strictEqual(channels.length, 1);
  assert.strictEqual(channels[0].channelId, 'UC123456789');
  assert.strictEqual(channels[0].channelName, 'Test Creator');
  assert.strictEqual(channels[0].status, 'connected');
  console.log('✓ getChannels matched successfully.');
  
  // 4. Test getChannelCredentials
  const creds = await db.getChannelCredentials('UC123456789');
  assert.ok(creds);
  assert.strictEqual(creds.client_secret, 'client_secret_secret');
  assert.strictEqual(creds.refresh_token, 'refresh_123');
  console.log('✓ getChannelCredentials retrieved secrets correctly.');
  
  // 5. Test updateChannelTokens
  await db.updateChannelTokens('UC123456789', 'new_access_token', 9999999999);
  const updatedCreds = await db.getChannelCredentials('UC123456789');
  assert.strictEqual(updatedCreds.access_token, 'new_access_token');
  assert.strictEqual(updatedCreds.expires_at, 9999999999);
  console.log('✓ updateChannelTokens updated tokens correctly.');
  
  // 6. Test savePlaylists & getCachedPlaylists
  const testPlaylists = [
    { id: 'PL1', title: 'Tutorials' },
    { id: 'PL2', title: 'Highlights' }
  ];
  await db.savePlaylists('UC123456789', testPlaylists);
  console.log('✓ savePlaylists succeeded.');
  
  const cachedPlaylists = await db.getCachedPlaylists('UC123456789');
  assert.strictEqual(cachedPlaylists.length, 2);
  assert.strictEqual(cachedPlaylists[0].id, 'PL1');
  assert.strictEqual(cachedPlaylists[0].title, 'Tutorials');
  console.log('✓ getCachedPlaylists retrieved cached playlists correctly.');
  
  // 7. Test createUploadLog & getUploadLogs
  const testUpload = {
    videoId: 'dQw4w9WgXcQ',
    title: 'Testing Clip Upload Log',
    startTime: 5.0,
    endTime: 15.0,
    playlistId: 'PL1',
    channelId: 'UC123456789'
  };
  
  const logId = await db.createUploadLog(testUpload);
  assert.ok(logId);
  console.log('✓ createUploadLog succeeded.');
  
  let logs = await db.getUploadLogs();
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].id, logId);
  assert.strictEqual(logs[0].status, 'pending');
  assert.strictEqual(logs[0].channelName, 'Test Creator');
  assert.strictEqual(logs[0].playlistTitle, 'Tutorials');
  console.log('✓ getUploadLogs retrieved initial log successfully.');
  
  // 8. Test updateUploadLog (completed)
  await db.updateUploadLog(logId, 'completed', { youtubeVideoId: 'newYTVideoId' });
  logs = await db.getUploadLogs();
  assert.strictEqual(logs[0].status, 'completed');
  assert.strictEqual(logs[0].youtubeVideoId, 'newYTVideoId');
  console.log('✓ updateUploadLog (completed) matched successfully.');
  
  // 9. Test deleteChannel (cascade test)
  await db.deleteChannel('UC123456789');
  const emptyChannels = await db.getChannels();
  assert.strictEqual(emptyChannels.length, 0);
  
  const emptyPlaylists = await db.getCachedPlaylists('UC123456789');
  assert.strictEqual(emptyPlaylists.length, 0);
  
  const emptyLogs = await db.getUploadLogs();
  assert.strictEqual(emptyLogs.length, 0);
  console.log('✓ deleteChannel successfully cascade-deleted playlists and upload logs.');
  
  console.log('\n--- All Database Tests Passed Successfully! ---');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
