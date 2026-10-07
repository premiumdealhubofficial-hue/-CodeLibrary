#!/usr/bin/env node

/**
 * CodeLibrary Production Database Backup CLI Script
 * 
 * Usage:
 *   node server/scripts/backup.js
 *   node server/scripts/backup.js --tag manual
 *   node server/scripts/backup.js --list
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { createDatabaseBackup, listBackups, BACKUP_DIR } = require('../utils/backup');
const { getDbPath } = require('../db/schema');

const args = process.argv.slice(2);

if (args.includes('--list')) {
  console.log(`\n=== CodeLibrary Database Backups Directory: ${BACKUP_DIR} ===`);
  const backups = listBackups();
  if (backups.length === 0) {
    console.log('No backups found yet.');
  } else {
    console.table(backups.map(b => ({
      Filename: b.filename,
      Size: b.sizeFormatted,
      Created: b.created_at
    })));
  }
  process.exit(0);
}

const tagIndex = args.indexOf('--tag');
const tag = tagIndex !== -1 && args[tagIndex + 1] ? args[tagIndex + 1] : 'cli';

console.log('Starting atomic SQLite database backup...');
console.log(`Source Database: ${getDbPath()}`);

try {
  const result = createDatabaseBackup({ tag });
  console.log('\n✅ Backup successfully created!');
  console.log(`• Filename: ${result.filename}`);
  console.log(`• Location: ${result.filepath}`);
  console.log(`• File Size: ${result.sizeFormatted}`);
  console.log(`• Timestamp: ${result.created_at}`);
  process.exit(0);
} catch (err) {
  console.error('\n❌ Backup failed:', err.message);
  process.exit(1);
}
