#!/usr/bin/env node
const command = process.argv[2];

if (command === 'doctor') {
  const { runDoctor } = await import('../lib/doctor.js');
  process.exitCode = await runDoctor();
} else if (command === '--help' || command === '-h') {
  console.log(`chuskybrowser -- browser server for AI agents

Usage:
  npx chuskybrowser           Start the server (default port 9377)
  npx chuskybrowser doctor    Check your setup and show how to fix anything missing
  npx chuskybrowser --help    Show this help

Settings are read from .env in the current folder. See the README for all options.`);
} else {
  await import('../server.js');
}
