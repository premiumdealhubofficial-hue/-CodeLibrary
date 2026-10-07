const fs = require('fs');
const path = require('path');
const { getDb, getDbPath } = require('../db/schema');
const config = require('./config');

const BACKUP_DIR = path.isAbsolute(config.BACKUP_DIR || 'backups')
  ? (config.BACKUP_DIR || 'backups')
  : path.join(__dirname, '..', '..', config.BACKUP_DIR || 'backups');

const MAX_RETENTION = parseInt(process.env.BACKUP_RETENTION_COUNT, 10) || 30;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  return BACKUP_DIR;
}

/**
 * Creates an atomic, online, consistent SQLite backup using VACUUM INTO
 * Safe to execute while the application and database are actively serving traffic.
 */
function createDatabaseBackup(options = {}) {
  const dir = ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = options.tag ? `_${options.tag.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  const filename = `codelibrary_backup_${timestamp}${tag}.sqlite`;
  const targetPath = path.join(dir, filename);

  const db = getDb();

  try {
    // Escape single quotes for SQLite string literal
    const safePath = targetPath.replace(/\\/g, '/').replace(/'/g, "''");
    db.exec(`VACUUM INTO '${safePath}';`);
  } catch (vacuumErr) {
    // If VACUUM INTO fails (e.g. destination exists), fallback to checkpoint + safe copy
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      const srcPath = getDbPath();
      fs.copyFileSync(srcPath, targetPath);
    } catch (copyErr) {
      throw new Error(`Backup failed: ${vacuumErr.message}; Fallback copy failed: ${copyErr.message}`);
    }
  }

  // Verify created backup exists and has valid size
  const stats = fs.statSync(targetPath);
  if (stats.size === 0) {
    fs.unlinkSync(targetPath);
    throw new Error('Created backup file is empty');
  }

  // Cleanup old backups beyond retention limit
  const keepCount = options.keepCount || MAX_RETENTION;
  cleanupOldBackups(keepCount);

  return {
    success: true,
    filename,
    filepath: targetPath,
    size: stats.size,
    sizeFormatted: (stats.size / 1024).toFixed(2) + ' KB',
    created_at: new Date().toISOString()
  };
}

/**
 * Lists all existing database backups with metadata
 */
function listBackups() {
  const dir = ensureBackupDir();
  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('.sqlite') || file.endsWith('.db') || file.endsWith('.bak'))
    .map(file => {
      const fullPath = path.join(dir, file);
      const stats = fs.statSync(fullPath);
      return {
        filename: file,
        filepath: fullPath,
        size: stats.size,
        sizeFormatted: (stats.size / 1024).toFixed(2) + ' KB',
        created_at: stats.mtime.toISOString(),
        mtime: stats.mtime
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return files;
}

/**
 * Removes backups exceeding retention count
 */
function cleanupOldBackups(keepCount = MAX_RETENTION) {
  try {
    const backups = listBackups();
    if (backups.length > keepCount) {
      const toDelete = backups.slice(keepCount);
      for (const item of toDelete) {
        if (fs.existsSync(item.filepath)) {
          fs.unlinkSync(item.filepath);
        }
      }
    }
  } catch (err) {
    console.warn('Backup cleanup notice:', err.message);
  }
}

module.exports = {
  createDatabaseBackup,
  listBackups,
  cleanupOldBackups,
  BACKUP_DIR
};
