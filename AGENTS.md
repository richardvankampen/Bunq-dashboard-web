# Bunq Dashboard Startup Instructions

## Required first reads (every new session)

1. Read `CONTEXT_HANDOVER.md` fully first.
2. Read the latest section(s) in `WORKLOG.md` second.
3. Treat `CONTEXT_HANDOVER.md` as the canonical current state.

## Working rules for this repository

1. On every code or script change, review and update:
   - `CONTEXT_HANDOVER.md`
   - `WORKLOG.md`
2. In `CONTEXT_HANDOVER.md`:
   - keep only current/best information;
   - remove outdated statements;
   - avoid duplicate information.
3. In Synology instructions, prefer root execution for install/update:
   - `sudo sh /volume1/docker/bunq-dashboard/scripts/install_or_update_synology.sh`
4. For manual stack deploy, always load `.env` explicitly:
   - `sudo sh -c 'set -a; . /volume1/docker/bunq-dashboard/.env; set +a; docker stack deploy -c /volume1/docker/bunq-dashboard/docker-compose.yml bunq'`

## Current focus

1. Keep Vaultwarden-first flow stable (`USE_VAULTWARDEN=true`).
2. Continue resolving missing savings accounts in `/api/accounts`.
3. Validate fixes with live logs and account output after each deploy.
