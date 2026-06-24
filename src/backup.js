import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../clipper.db');
const backupsDir = path.resolve(__dirname, '../backups');

export function runBackup() {
  console.log('[ClapClip Backup] Initiating database backup...');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`[ClapClip Backup] Source database file not found at: ${dbPath}`);
    return;
  }

  // Ensure backups/ folder exists
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  // Generate timestamped filename (e.g., clipper_20260624_152200.db)
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/T/, '_')
    .replace(/\..+/, '')
    .replace(/[^a-zA-Z0-9_]/g, ''); // format: YYYYMMDD_HHMMSS
  
  const destPath = path.join(backupsDir, `clipper_${timestamp}.db`);

  // Perform database copy
  try {
    fs.copyFileSync(dbPath, destPath);
    console.log(`[ClapClip Backup] Backup created successfully: ${destPath}`);

    // Manage retention: Keep latest 7 backups
    const files = fs.readdirSync(backupsDir)
      .filter(file => file.startsWith('clipper_') && file.endsWith('.db'))
      .sort() // Alphabetically ascending (oldest first)
      .reverse() // Alphabetically descending (newest first)
      .map(file => ({
        name: file,
        filePath: path.join(backupsDir, file)
      }));

    if (files.length > 7) {
      const extraFiles = files.slice(7);
      extraFiles.forEach(file => {
        fs.unlinkSync(file.filePath);
        console.log(`[ClapClip Backup] Removed old backup file: ${file.name}`);
      });
    }
  } catch (err) {
    console.error('[ClapClip Backup] FATAL: Failed to complete backup operation:', err);
  }
}

// Run directly when called via Node CLI
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('backup.js') || 
  process.argv[1].endsWith('backup')
);

if (isDirectRun) {
  runBackup();
}
