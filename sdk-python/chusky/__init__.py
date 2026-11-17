"""chuskybrowser Python client. See client.py and the docs at docs/sdk/python.mdx."""

from .client import ChuskyClient, ChuskyError, DEFAULT_GATEWAY_URL

__all__ = ["ChuskyClient", "ChuskyError", "DEFAULT_GATEWAY_URL"]
__version__ = "1.21.0"
