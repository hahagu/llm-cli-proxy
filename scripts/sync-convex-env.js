#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

/**
 * Set a Convex environment variable
 * Uses stdin to pass the value, avoiding shell escaping issues
 */
function setConvexEnv(key, value) {
  try {
    // Pass value via stdin to avoid shell escaping issues with special characters
    const result = spawnSync('bunx', ['convex', 'env', 'set', key], {
      cwd: rootDir,
      input: value,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (result.status !== 0) {
      const error = result.stderr?.trim() || result.stdout?.trim() || 'Unknown error';
      return { success: false, error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function removeConvexEnv(key) {
  const result = spawnSync('bunx', ['convex', 'env', 'remove', key], {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    const error = result.stderr?.trim() || result.stdout?.trim() || 'Unknown error';
    return { success: false, error };
  }

  return { success: true };
}

function parseEscapedValue(raw) {
  // Decode common escape sequences so "\n" and friends become real characters
  return raw.replace(/\\(.)/g, (_match, char) => {
    switch (char) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '\\':
        return '\\';
      case '"':
        return '"';
      default:
        return char;
    }
  });
}

function decodeEnvVars(envVars) {
  return Object.fromEntries(
    Object.entries(envVars).map(([key, value]) => [
      key,
      parseEscapedValue(value ?? '')
    ])
  );
}

function listConvexEnvKeys() {
  const result = spawnSync('bunx', ['convex', 'env', 'list'], {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    const error = result.stderr?.trim() || result.stdout?.trim() || 'Unknown error';
    return { success: false, error };
  }

  const output = result.stdout?.trim() || '';

  // Parse plain text output lines to extract keys
  const keyPattern = /^[A-Z0-9_]+$/;
  const keys = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([A-Z0-9_]+)\s*(?:=|$)/);
      return match ? match[1] : null;
    })
    .filter((key) => key && keyPattern.test(key));

  return { success: true, keys: Array.from(new Set(keys)) };
}

async function main() {
  const envPath = join(rootDir, '.env.convex');
  
  // Check if file exists
  if (!existsSync(envPath)) {
    console.error('❌ .env.convex file not found');
    process.exit(1);
  }

  console.log('📂 Reading .env.convex...\n');
  
  const content = readFileSync(envPath, 'utf-8');
  const envVars = decodeEnvVars(parse(content));
  
  const keys = Object.keys(envVars);
  
  if (keys.length === 0) {
    console.log('⚠️  No environment variables found in .env.convex');
    process.exit(0);
  }

  console.log(`Found ${keys.length} environment variable(s):\n`);
  
  // Preview variables (show truncated values for security)
  for (const key of keys) {
    const value = envVars[key];
    const preview = value.length > 50 
      ? value.slice(0, 50).replace(/\n/g, '\\n') + '...' 
      : value.replace(/\n/g, '\\n');
    console.log(`  ${key}=${preview}`);
  }
  
  console.log('\n🧹 Removing existing Convex environment variables...\n');

  const listResult = listConvexEnvKeys();
  if (!listResult.success) {
    console.error(`❌ Failed to list existing variables: ${listResult.error}`);
    process.exit(1);
  }

  let removedCount = 0;
  for (const key of listResult.keys) {
    process.stdout.write(`  Removing ${key}... `);
    const result = removeConvexEnv(key);
    if (result.success) {
      console.log('✓');
      removedCount++;
    } else {
      console.log('✗');
      console.error(`    Error: ${result.error}`);
    }
  }

  console.log(`\n🗑️  Removed ${removedCount} existing variable(s)\n`);
  console.log('🚀 Setting Convex environment variables...\n');
  
  let successCount = 0;
  let failCount = 0;
  
  for (const key of keys) {
    const value = envVars[key];
    process.stdout.write(`  Setting ${key}... `);
    
    const result = setConvexEnv(key, value);
    
    if (result.success) {
      console.log('✓');
      successCount++;
    } else {
      console.log('✗');
      console.error(`    Error: ${result.error}`);
      failCount++;
    }
  }
  
  console.log('\n' + '─'.repeat(40));
  console.log(`✅ ${successCount} variable(s) set successfully`);
  
  if (failCount > 0) {
    console.log(`❌ ${failCount} variable(s) failed`);
    process.exit(1);
  }
  
  console.log('\n💡 Run `bunx convex env list` to verify');
}

main().catch((error) => {
  console.error('❌ Script failed:', error.message);
  process.exit(1);
});

