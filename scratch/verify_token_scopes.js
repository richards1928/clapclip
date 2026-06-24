import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../clipper.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  db.get("SELECT access_token FROM channels LIMIT 1", [], async (err, row) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    if (!row || !row.access_token) {
      console.log("No channel or access token found in the database. Please authorize the channel in the UI first.");
      db.close();
      return;
    }
    const token = row.access_token;
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
      const data = await res.json();
      console.log("Token info from Google:");
      console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("Failed to fetch tokeninfo:", e);
    }
    db.close();
  });
});
