# chuskybrowser-sdk

Give your app a browser. Open pages, read them, sign in to sites without your code seeing the password, hand a page to a person, and buy things for your users.

```bash
npm install chuskybrowser-sdk
```

Set your API key as `CHUSKYBROWSER_API_KEY`. Then create a browser for each end user:

```js
import { forUser } from 'chuskybrowser-sdk';

// One browser per end user. Take the id from your own session, never from user-typed text.
const browser = forUser(userIdFromYourSession);
```

## 1. Open a page and read it

```js
const { tabId } = await browser.openTab({ url: 'https://example.com', sessionKey: 'task-1' });
const page = await browser.snapshot(tabId); // the page, with element refs like e1, e2
console.log(page);
await browser.closeTab(tabId);
```

## 2. Click and type

```js
const { tabId } = await browser.openTab({ url: 'https://duckduckgo.com', sessionKey: 'search-1' });
const page = await browser.snapshot(tabId);
// Find the search box's ref in page, then:
await browser.type(tabId, { ref: 'e2', text: 'weather in London', pressEnter: true });
await browser.wait(tabId, { selector: 'h1', timeout: 10000 });
```

## 3. Sign in with a saved login

Your code never sees the password. The SDK fills it straight into the page.

```js
const logins = await browser.listLogins(); // site, label and id only
const { tabId } = await browser.openTab({ url: 'https://app.example.com/login', sessionKey: 'login-1' });

await browser.fillLogin(tabId, { loginId: logins.logins[0].id, submit: true });
```

If the site asks for a verification code, `fillLogin` throws `verification_code_needed`. Hand the tab to the person, as in example 4.

## 4. Hand the page to a person

Use this for a code, a CAPTCHA, or anything only the user can do.

```js
await browser.startHandoff(tabId, { reason: 'Enter the code we sent you', idleMs: 600000 });
const link = await browser.viewerLink(tabId, { control: true, ttlSeconds: 900 });
// Send link.url to that user only. When they are done:
await browser.release(tabId);
```

While a person holds the tab, the agent's calls on it return a `409`. Wait for the release.

## 5. Let an agent buy for the user

```js
const cards = await browser.listCards(); // check the response for a stored card
if (!hasCard(cards)) {
  const enrol = await browser.enrolCard();
  // Send the enrol link to the user. They enter their card there, not in your app.
}

const result = await browser.buy({ ask: 'a large margherita from Joe\'s Pizza', threadId: 'chat-42', confirm: false });
```

`confirm` must be `true` only after the user says yes to the cart.

## 6. Use it as a tool in an OpenRouter agent

Give the model a browser tool. Each tool call runs through the SDK. Keep the `userId` in your code.

```js
import { forUser } from 'chuskybrowser-sdk';

const tools = [{
  type: 'function',
  function: {
    name: 'open_page',
    description: 'Open a web page in a new browser tab. Returns the tab id.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
}];

async function runTool(browser, name, args) {
  if (name === 'open_page') return browser.openTab({ url: args.url, sessionKey: 'agent-1' });
  return { error: `unknown tool ${name}` };
}

async function agent(userId, task) {
  const browser = forUser(userId);
  const messages = [{ role: 'user', content: task }];

  for (let step = 0; step < 8; step += 1) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'anthropic/claude-sonnet-4.5', messages, tools }),
    });
    const { choices } = await res.json();
    const msg = choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return msg.content;

    for (const call of msg.tool_calls) {
      const result = await runTool(browser, call.function.name, JSON.parse(call.function.arguments));
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
    }
  }
}

console.log(await agent('user-123', 'Open example.com and tell me the page heading.'));
```

## Errors

Errors are `ChuskyError`, with `.status` and `.code`.

## Keep your key private

Your API key belongs to your account. Don't put it in client-side code or public repos.
