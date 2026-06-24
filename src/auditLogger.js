import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const auditLogDir = path.resolve(__dirname, '../logs');
const auditLogPath = path.join(auditLogDir, 'audit.log');

/**
 * Logs a structured audit event to logs/audit.log as a JSON Line.
 * @param {string} eventType - Type of security or operational event.
 * @param {Object} details - Additional key-value details about the event.
 */
export function logAuditEvent(eventType, details = {}) {
  // Ensure logs/ folder exists
  if (!fs.existsSync(auditLogDir)) {
    fs.mkdirSync(auditLogDir, { recursive: true });
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    event: eventType,
    ...details
  };

  try {
    fs.appendFileSync(auditLogPath, JSON.stringify(logEntry) + '\n', 'utf8');
  } catch (err) {
    console.error('[ClapClip Audit Log] Failed to write audit event:', err);
  }
}
