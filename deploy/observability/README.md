# Observability (example)

Example configuration for viewing PodNoms' logs and errors with free,
self-hosted tools. Copy what you need into the compose file that runs next to
PodNoms; nothing here is used by the app itself.

- **Logs:** Grafana Alloy reads the logs of containers labelled `logging=alloy`
  from Docker and sends them to Loki. You browse them in Grafana.
- **Errors:** GlitchTip, an open-source, Sentry-compatible error tracker, groups
  errors into issues with stack traces. You can resolve or ignore them, and it
  emails you about new ones.

```text
podnoms (stdout JSON) ──docker──▶ alloy ──▶ loki ◀── grafana (dashboard, alert)
podnoms (Sentry SDK) ───────────────────────────────▶ glitchtip (issues, email)
```

## Files

| File | What it is |
| --- | --- |
| `compose.yml` | Loki, Alloy and GlitchTip (one all-in-one container plus Postgres) |
| `loki/config.yaml` | Single-process Loki on local disk, keeping 30 days of logs |
| `alloy/config.alloy` | Docker log collection; makes `level` and `app` labels |
| `grafana/provisioning/datasources/loki.yaml` | The Loki data source (uid `podnoms-loki`) |
| `grafana/provisioning/dashboards/podnoms.yaml` + `grafana/dashboards/podnoms.json` | The "PodNoms logs" dashboard |
| `grafana/provisioning/alerting/podnoms.yaml` | Alert rule: any error in the last 5 minutes |

## Setting up

1. **Label the app container.** The main [`compose.yml`](../../compose.yml) already
   has `labels: { logging: alloy }` on `app`. Copy that to your own compose file.
2. **Run Loki and Alloy** from `compose.yml` here. Alloy needs read access to
   `/var/run/docker.sock` on the host that runs PodNoms.
3. **Connect Grafana.** Grafana must be able to reach Loki, e.g. by sharing a
   network with it. Then either add a Loki data source and import the
   dashboard JSON in the UI (it asks which Loki data source to use), or
   provision both by mounting the files as shown in the comment in
   `compose.yml`. In
   `provisioning/alerting/podnoms.yaml`, change `receiver: CHANGE-ME` to one of
   your contact points. Restart Grafana.
4. **Run GlitchTip.** Set `GLITCHTIP_SECRET_KEY` (`openssl rand -hex 32`),
   `GLITCHTIP_POSTGRES_PASSWORD`, `GLITCHTIP_DOMAIN` (its public URL) and, for
   email, `GLITCHTIP_EMAIL_URL` (any SMTP account works, e.g.
   `smtp+tls://you%40gmail.com:app-password@smtp.gmail.com:587`). Start it with
   `GLITCHTIP_REGISTRATION=true`, create your account, then set it back to
   `false`.
5. **Create a GlitchTip project** (platform: JavaScript/Node) and copy its DSN
   into PodNoms' `SENTRY_DSN`. The server and the browser both report to it;
   restart PodNoms to pick it up.

## Checking it works

- In Grafana **Explore**, choose the Loki data source and run `{app="podnoms"}`.
  You should see a line per request. Filter with `{app="podnoms", level="error"}`,
  and pull out fields with `| json`, e.g.
  `{app="podnoms"} | json | episodeId="…"`.
- Add an episode from a link that can't be downloaded. Within a minute or two
  you should see an `Episode processing failed` line in the dashboard, an issue
  in GlitchTip, and the Grafana alert.

## Useful queries

| Want | LogQL |
| --- | --- |
| Errors and warnings | `{app="podnoms", level=~"error\|fatal\|warn"} \| json` |
| One episode's history | `{app="podnoms"} \| json \| episodeId="<id>"` |
| Failed episode jobs | `{app="podnoms"} \| json \| msg=~"Episode .* failed"` |
| Slow requests | `{app="podnoms"} \| json \| msg="Request" \| durationMs > 1000` |
| Second-factor failures | `{app="podnoms"} \| json \| msg=~"Second factor.*"` |
