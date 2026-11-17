# chuskybrowser (Python)

Standard library only. Requires Python 3.9 or newer.

```bash
pip install chuskybrowser
```

Set `CHUSKYBROWSER_API_KEY` in your environment or in a `.env` file.

```python
from chusky import ChuskyClient

browser = ChuskyClient(user_id=user_id_from_your_session)  # never from user-typed text
tab = browser.open_tab(url="https://example.com", session_key="task-1")
page = browser.snapshot(tab["tabId"])
browser.close_tab(tab["tabId"])
```

Full guide: `docs/sdk/python.mdx`.
