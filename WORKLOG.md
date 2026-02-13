# Worklog

Dit bestand houdt een compacte voortgangshistorie bij, zodat chatcontextverlies geen impact heeft.

## 2026-02-13

### Opgeleverd

- Vaultwarden-first flow verder uitgewerkt en gestabiliseerd.
- Vaultwarden CLI decrypt flow toegevoegd als primaire methode voor Bunq API key retrieval.
- Validatie en onderhoud rond Bunq IP allowlist toegevoegd.
- Admin maintenance endpoints en UI-acties toegevoegd:
  - status check
  - egress IP check
  - Bunq context reinitialize
  - whitelist update
  - bundled maintenance run
- Inputvalidatie aangescherpt (publiek IPv4 voor whitelist-target).
- Restart-/updateflows robuuster gemaakt via scripts.
- Documentatie bijgewerkt voor scripts en maintenance flow.
- Terminal helper-buttons toegevoegd in admin panel.

### Relevante commits (nieuw → oud)

- `2dd7725` Add admin panel terminal-command helper buttons
- `b5b737f` Add conservative Synology install/update helper script
- `d1a368c` Validate whitelist target as public IPv4 in UI and backend
- `37c8b89` Make admin maintenance always whitelist with manual-or-auto target IP
- `030d333` Set admin maintenance refresh-key default to off
- `62bf80b` Add admin panel bundled maintenance with configurable defaults
- `7165844` Auto-tag restart script and prune old bunq-dashboard images
- `d4d4094` Harden restart script for missing/failed image updates
- `d48cff0` Fix Bitwarden CLI checksum lookup for bw zip
- `71d6c20` Add Bunq allowlist API automation and admin whitelist action
- `f34900e` Document and script image-tagged restart validation flow
- `7aac535` Add restart validation script and document admin restart checks
- `43cd79d` Suppress debconf frontend warnings during Docker build
- `a52aebb` Support arm64 by using npm fallback for bw CLI
- `3c377f0` Use native pinned bw binary instead of Node/NPM

## Huidige status (samenvatting)

- Preferred secret-flow: `USE_VAULTWARDEN=true`.
- Directe `bunq_api_key` flow blijft fallback-only.
- Session auth actief; secure cookie instelling en CORS-checks aanwezig.
- P1 admin maintenance tooling staat in code en UI.

## Openstaande focus

- Doorgaan met volgende P1-substap voor dashboard/functionele verbeteringen op basis van jouw feedback.

