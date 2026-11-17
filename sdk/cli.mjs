#!/usr/bin/env node
// cb: a command line for the chuskybrowser API. Wraps the SDK in this folder.
//
//   export CHUSKYBROWSER_API_KEY=cb_live_...      (or put it in .env)
//   cb open https://example.com --user alice --session task-1
//
// Every command needs CHUSKYBROWSER_API_KEY and --user (the end user's id).
// Output is JSON, so you can pipe it into jq or another script.
// The API key is never printed.
import { writeFileSync } from 'node:fs';
import { ChuskyClient } from './chusky-client.mjs';

const USAGE = `cb -- command line for the chuskybrowser API

Set CHUSKYBROWSER_API_KEY (in .env or your environment). Every command needs --user <id>.

Tabs
  cb open <url> --user U [--session S] [--trace]
  cb navigate <tabId> <url> --user U
  cb state <tabId> --user U
  cb snapshot <tabId> --user U
  cb screenshot <tabId> --user U --out page.png
  cb click <tabId> --user U (--ref e1 | --selector "css")
  cb type <tabId> --user U (--ref e2 | --selector "css") --text "hello" [--enter]
  cb press <tabId> --user U --key Enter
  cb scroll <tabId> --user U [--direction down] [--amount 300]
  cb close <tabId> --user U
  cb end --user U                      close every tab for this user

Hand a tab to a person
  cb handoff start <tabId> --user U [--reason "Sign in, then press Done"]
  cb handoff release <tabId> --user U
  cb link <tabId> --user U [--control]  print a live view link (control needs an active handoff)

Other
  cb help
`;

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function needUser(flags) {
  if (typeof flags.user !== 'string' || !flags.user.trim()) {
    throw new Error('Pass --user <id>, the end user this command acts for.');
  }
  return flags.user.trim();
}

function needArg(value, what) {
  if (!value || value === true) throw new Error(`Missing ${what}. Run "cb help" for usage.`);
  return value;
}

async function run() {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, ...args] = pos;
  if (!cmd || cmd === 'help' || cmd === '--help' || flags.help) {
    console.log(USAGE);
    return;
  }

  // The SDK reads CHUSKYBROWSER_API_KEY from .env or the environment and throws a clear error if it is missing.
  const userId = needUser(flags);
  const client = new ChuskyClient({ userId });

  switch (cmd) {
    case 'open': {
      const url = needArg(args[0], 'URL');
      print(await client.openTab({ url, sessionKey: flags.session || 'cli', trace: !!flags.trace }));
      return;
    }
    case 'navigate': {
      const tabId = needArg(args[0], 'tab id');
      const url = needArg(args[1], 'URL');
      print(await client.navigate(tabId, { url }));
      return;
    }
    case 'state':
      print(await client.state(needArg(args[0], 'tab id')));
      return;
    case 'snapshot':
      print(await client.snapshot(needArg(args[0], 'tab id')));
      return;
    case 'screenshot': {
      const tabId = needArg(args[0], 'tab id');
      const out = needArg(flags.out, '--out <file.png>');
      writeFileSync(out, await client.screenshot(tabId));
      print({ saved: out });
      return;
    }
    case 'click': {
      const tabId = needArg(args[0], 'tab id');
      print(await client.click(tabId, { ref: flags.ref, selector: flags.selector }));
      return;
    }
    case 'type': {
      const tabId = needArg(args[0], 'tab id');
      const text = needArg(flags.text, '--text "..."');
      print(await client.type(tabId, { ref: flags.ref, selector: flags.selector, text, pressEnter: !!flags.enter }));
      return;
    }
    case 'press':
      print(await client.press(needArg(args[0], 'tab id'), { key: needArg(flags.key, '--key') }));
      return;
    case 'scroll': {
      const tabId = needArg(args[0], 'tab id');
      const amount = flags.amount ? Number(flags.amount) : undefined;
      print(await client.scroll(tabId, { direction: flags.direction || 'down', amount }));
      return;
    }
    case 'close':
      print(await client.closeTab(needArg(args[0], 'tab id')));
      return;
    case 'end':
      print(await client.endSession());
      return;
    case 'handoff': {
      const action = needArg(args[0], 'start or release');
      const tabId = needArg(args[1], 'tab id');
      if (action === 'start') {
        const handoff = await client.startHandoff(tabId, {
          reason: typeof flags.reason === 'string' ? flags.reason : 'Please complete this step in the live view, then press Done.',
        });
        const viewerUrl = await client.viewerLink(tabId, { control: true });
        print({ handoff, viewerUrl });
        console.error('This link is for this user only. Do not share it.');
        return;
      }
      if (action === 'release') {
        print(await client.release(tabId));
        return;
      }
      throw new Error('Use "cb handoff start <tabId>" or "cb handoff release <tabId>".');
    }
    case 'link': {
      const tabId = needArg(args[0], 'tab id');
      const url = await client.viewerLink(tabId, { control: !!flags.control });
      print({ url });
      console.error('This link is for this user only. Do not share it.');
      return;
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run "cb help" for usage.`);
  }
}

try {
  await run();
} catch (err) {
  console.error(`FAIL  ${err.message}`);
  process.exitCode = 1;
}
