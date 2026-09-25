"""
Gunicorn hooks for the Bunq dashboard (loaded via --config in run_server.sh).

Startup flow with --preload (API key fetched from Vaultwarden once, in the master):
1. master imports api_proxy          -> API key fetched once
2. on_starting (master)              -> preboot Bunq init: context file + auto-whitelist
3. post_fork (each worker)           -> drop inherited Bunq state, keep the API key
4. post_worker_init (each worker)    -> background Bunq warm-up from the context file,
                                        plus the monthly reconcile scheduler thread
Recycled workers (max_requests) repeat steps 3-4 without fetching the key again.
"""


def on_starting(server):
    import api_proxy

    try:
        api_proxy.run_preboot_init()
    except Exception as exc:  # never block startup on preboot init
        server.log.warning(f"Preboot Bunq init failed: {exc}")


def post_fork(server, worker):
    import api_proxy

    api_proxy.reset_bunq_state_after_fork()


def post_worker_init(worker):
    # Each worker process has its own BunqContext; connect it in the background
    # right away so /api/health is accurate and the first request isn't slow.
    import api_proxy

    api_proxy.start_background_bunq_init()
    # Monthly nightly reconcile checker; a file lock lets only one worker run it.
    api_proxy.start_reconcile_scheduler()
