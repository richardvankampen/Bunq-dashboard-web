"""Gunicorn hooks for the Bunq dashboard (loaded via --config in run_server.sh)."""


def post_worker_init(worker):
    # Each worker process has its own BunqContext; connect it in the background
    # right away so /api/health is accurate and the first request isn't slow.
    import api_proxy

    api_proxy.start_background_bunq_init()
