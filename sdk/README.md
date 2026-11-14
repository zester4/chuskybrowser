# chuskybrowser-sdk

Client SDK for chuskybrowser. Open tabs, read pages, and sign in with the login vault without the agent seeing passwords.

```js
import { forUser, ChuskyClient, ChuskyError } from 'chuskybrowser-sdk';

const browser = forUser(userIdFromYourSession);
const { tabId } = await browser.openTab({ url: 'https://example.com', sessionKey: 'task-1' });
```

Customers set `CHUSKYBROWSER_API_KEY`. Self-hosted servers set `CHUSKY_BASE_URL` and `CHUSKY_ACCESS_KEY`.

Vault methods: `saveLogin`, `listLogins`, `deleteLogin`, `fillLogin`. `fillLogin` throws `verification_code_needed` when a person must enter a code.

Full docs: https://github.com/zester4/chuskybrowser/blob/main/docs/sdk/vault.mdx
