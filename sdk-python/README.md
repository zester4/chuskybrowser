# chuskybrowser (Python)

Give your app a real browser. Open pages, read them, click and type, take screenshots, and hand a page to a person when a sign-in or a check needs them. Each user gets their own browser.

Standard library only. Requires Python 3.9 or newer.

## Install

```bash
pip install chuskybrowser
```

## Set your key

Set your API key once, either in your environment or in a `.env` file in the folder you run from:

```bash
CHUSKYBROWSER_API_KEY=cb_live_...
```

Never put the key in code you share or commit. The client reads it for you.

## Example 1: open a page and read it

Save this as `read_page.py` and run `python read_page.py`.

```python
from chusky import ChuskyClient

# One client per end user. In your app, use the logged-in user's ID.
browser = ChuskyClient(user_id="test-user-1")

tab = browser.open_tab(url="https://example.com", session_key="demo-1")
tab_id = tab["tabId"]

page = browser.snapshot(tab_id)   # the page, with element refs such as e1, e2
print(page)

browser.close_tab(tab_id)
```

## Example 2: type into a search box

```python
from chusky import ChuskyClient

browser = ChuskyClient(user_id="test-user-1")

tab_id = browser.open_tab(url="https://duckduckgo.com", session_key="search-1")["tabId"]
browser.type(tab_id, "weather in London", selector="input[name=q]", press_enter=True)

print(browser.state(tab_id))      # page state: url, title, whether it is loading
browser.end_session()             # close every tab for this user
```

## Example 3: save a screenshot

```python
from chusky import ChuskyClient

browser = ChuskyClient(user_id="test-user-1")
tab_id = browser.open_tab(url="https://example.com", session_key="shot-1")["tabId"]

with open("page.png", "wb") as f:
    f.write(browser.screenshot(tab_id))

browser.close_tab(tab_id)
```

## Example 4: sign in with a person (handoff)

The agent opens the sign-in page, then pauses while a person signs in through a live view link.

```python
from chusky import ChuskyClient, ChuskyError

browser = ChuskyClient(user_id="test-user-1")
tab_id = browser.open_tab(url="https://x.com/login", session_key="x-login")["tabId"]

browser.start_handoff(tab_id, reason="Sign in to X, then press Done")

# Send this link to that user only. It works for this one tab and expires.
print("Sign in here:", browser.viewer_link(tab_id, control=True))

input("Press Enter after the person has pressed Done in the live view...")

try:
    browser.release(tab_id)        # hand the tab back to the agent
except ChuskyError:
    pass                           # already released if Done was pressed

print(browser.state(tab_id))
browser.close_tab(tab_id)
```

## Handle errors

Every failed call raises `ChuskyError`, with `status`, `code` and `body`:

```python
from chusky import ChuskyClient, ChuskyError

browser = ChuskyClient(user_id="test-user-1")

try:
    browser.state("some-tab-id")
except ChuskyError as err:
    if err.code == "human_in_control":
        print("A person holds this tab. Wait, then try again.")
    elif err.status == 404:
        print("This tab was closed, or it belongs to another user.")
    else:
        raise
```

## Rules to follow

- **Take the user ID from your own login system.** Never use text a user types.
- **Keep the key on your server.** Never put it in a browser or mobile app.
- **Send a live view link only to the user it was made for.**

## Command line

Prefer the terminal? The `cb` command is in the npm package:

```bash
npm install -g chuskybrowser-sdk
cb help
```

## More

Full guide, with every method: https://github.com/zester4/chuskybrowser/blob/main/docs/sdk/python.mdx
