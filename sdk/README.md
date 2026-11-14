# chuskybrowser-sdk

Give your app a browser. Open tabs, read pages, and sign in to sites without the agent seeing passwords.

```bash
npm install chuskybrowser-sdk
```

Set your API key as `CHUSKYBROWSER_API_KEY`, then:

```js
import { forUser } from 'chuskybrowser-sdk';

const browser = forUser(userIdFromYourSession);
const { tabId } = await browser.openTab({ url: 'https://example.com', sessionKey: 'task-1' });
```

Use one `userId` per end user, from your own session. Never take it from user-typed text.

Errors are `ChuskyError`, with `.status` and `.code`.

## Keep your key private

Your API key belongs to your account. Don't put it in client-side code or public repos.
