# Release-opmerkingen

## 🌐 Taal

- Nederlands (dit bestand): [RELEASE_NOTES-NL.md](RELEASE_NOTES-NL.md)
- English: [RELEASE_NOTES.md](RELEASE_NOTES.md)

## 2026-03-07

### Backend verbeteringen
- `api_proxy.py`: `RateLimiter` geheugenfix (onbegrensd groei onder botverkeer); endpoint discovery gecachet na eerste aanroep; vijf `discover_*_endpoints()` functies samengevoegd in één generieke helper; `list_payments_for_account` en `list_card_payments_for_account` samengevoegd met gedeelde paginatie; bool env-helpers; moduleniveau page-size constanten; `executemany` voor batch DB-writes; dode code verwijderd.

### Frontend verbeteringen
- CSS: dubbele `cursor: pointer` classes samengevoegd; dode `.viz-card.featured-card` selector verwijderd; overbodige `max-width` declaraties verwijderd.
- HTML: AOS stylesheet verplaatst naar `<head>` (voorkomt flikkering bij laden); Plotly, Chart.js en Particles.js laden nu met `defer` (blokkeren HTML-parsing niet meer).
- JS: onbereikbare branch verwijderd in `classifyAccountType`; loginknop-icoon wordt nu correct hersteld na een mislukte loginpoging.

### Tooling
- `CLAUDE.md` toegevoegd aan repo root voor Claude Code sessie-context.
- GitHub CLI (`gh`) geïnstalleerd en geauthenticeerd voor remote repo-beheer.

## 2026-03-06

### Functies
- IP-wijziging runbook toegevoegd aan `README.md` / `README-NL.md`: copy/paste blok met drie commando's voor whitelist-update, service-restart en health check.

### Scripts
- `scripts/register_bunq_ip.sh` herschreven: target-IP wordt nu automatisch bepaald (host publieke IPv4 via `curl -4`, container egress als fallback); harde fout als geen publiek IP gevonden; deactivation/cleanup-flow verwijderd.

### Documentatie
- `README.md`, `README-NL.md`, `TROUBLESHOOTING.md`, `TROUBLESHOOTING-NL.md`, `SECURITY.md`, `SECURITY-NL.md`, `SYNOLOGY_INSTALL-NL.md` bijgewerkt met nieuwe IP-registratieflow en advies voor vast/sticky publiek IP.

## 2026-03-01

### Documentatie
- Nederlandstalige user-facing documentatie is taalkundig opgeschoond om onnodig Engels te verminderen, terwijl technische termen waar passend behouden zijn.
- Bijgewerkte bestanden:
  - `README-NL.md`
  - `SECURITY-NL.md`
  - `SYNOLOGY_INSTALL-NL.md`
  - `TROUBLESHOOTING-NL.md`
- Geen runtime- of API-gedragswijzigingen in deze update.

