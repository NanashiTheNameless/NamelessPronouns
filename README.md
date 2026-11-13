# NamelessPronouns

Self-hosted public pronoun and name pages.

## Crawler defense

Both Compose files include a private [Iocaine](https://iocaine.madhouse-project.org/)
service. Identified crawler user agents, signed agents, and known crawler IPs
receive its generated labyrinth before cookies, sessions, profiles, or account
actions are processed. A hidden link leads into `/reference-archive/`; generated
links stay under that path. Crawler writes receive 403, and the archive accepts
only GET and HEAD. Ordinary browsers, curl and text browsers retain normal access;
`/robots.txt`, `/healthz` and `/readyz` remain available for GET and HEAD.
The bundled corpus in `config/iocaine` comes from the order-system archive, paired
with an expanded neutral URL word list. These replace Iocaine's default source-code corpus. The app rebuilds its
output as escaped paragraphs beneath a fixed archive heading, with generated
paths encoded into `/reference-archive/entry/...` links. Generator headings,
footer, markup, and raw URL words are not exposed. Restart Iocaine after changing
its corpus or word list; both Compose files mount them read-only.

To test the trap on yourself, set your browser's user agent to
`Tarpit-Test/1.0` (or append that token to your normal user agent).
Reload an ordinary page such as `/` or `/status` to receive Iocaine's labyrinth.
Restore your normal user agent and open `/` again to leave it. The opt-in applies
only to requests carrying that token: it sets no cookies, creates no IP ban,
and does not alter your account or session. Explicit `/reference-archive/` URLs
remain in the maze, so leave that path when finishing the test. This respects
the defense/trap enable settings and the monitoring/robots exemptions above.
You can also test a single request from a terminal:

```sh
curl -A 'Tarpit-Test/1.0' https://pronouns.example.invalid/status
```

Operator-published IP feeds refresh automatically at startup and every six hours,
outside the request path. The matcher supports IPv4 and IPv6. Failed feeds retain
their last successful ranges for up to 30 days; expired ranges are discarded.
Compose persists the cache in `crawler-cache`, with a bundled snapshot for a
fresh install. Refresh the bundled snapshot manually with `npm run refresh-crawler-ips`.
Additional known crawler addresses or CIDRs can be set in `BOT_BLOCKED_CIDRS`.
This is identification-based protection; unlisted crawlers can evade detection.

`BOT_TRUST_CLOUDFLARE=true` trusts `CF-Connecting-IP` and must be used only when
the origin is private and reachable exclusively through Cloudflare Tunnel, as in
production Compose. It defaults to false for direct Node/development access;
there the socket peer is used and forwarded IP headers are ignored. If exposing
the origin directly or changing proxy topology, leave this disabled until the
trusted client-address boundary is configured. The development Compose tunnel
profile also leaves this disabled because the app has a direct local port.

Iocaine never receives request cookies, credentials, query strings, real profile
paths, or incoming decision headers. It has no published host port. Responses
are uncached and served with a restrictive content policy. Requests wait 250 ms,
with at most 16 active decoys per app process, a five-second upstream timeout,
and a 64 KiB response limit. If Iocaine fails or returns its 421 fallthrough
signal, the app serves a small local maze and retries Iocaine after 30 seconds.

Set `BOT_TRAP_ENABLED=false` to return 403 to identified crawlers instead of
serving decoys. Set `BOT_IP_REFRESH_ENABLED=false` to use only cached/bundled and
manually configured ranges, or `BOT_DEFENSE_ENABLED=false` to disable this layer.
When running Node outside Compose, set `IOCAINE_URL` to a private Iocaine origin
configured using `config/iocaine/00-archive.kdl`, or leave it empty to use the
local fallback. Never expose Iocaine's trusted decision header endpoint publicly.

Common-password warnings use the source lists in
[`data/Known-Passwords`](data/Known-Passwords), collected from
[SecLists](https://github.com/danielmiessler/SecLists). Browsers receive only a
generated probabilistic hash index, not the source password lists.

## Legal

- [NNCL v1.5](LICENSE.md)
- [Terms of Service](docs/legal/TERMS.md)
- [Privacy Policy](docs/legal/PRIVACY.md)

The bundled 0xProto font uses the SIL Open Font License 1.1.

## Support My Work

If this project is useful to you, you can support it here:

- [<https://github.com/sponsors/NanashiTheNameless>](<https://github.com/sponsors/NanashiTheNameless>)
- [<https://buymeacoffee.com/NamelessNanashi>](<https://buymeacoffee.com/NamelessNanashi>)
- [<https://ko-fi.com/NanashiTheNameless>](<https://ko-fi.com/NanashiTheNameless>)
- [<https://liberapay.com/NamelessNanashi>](<https://liberapay.com/NamelessNanashi>)
- [<https://throne.com/NamelessNanashi>](<https://throne.com/NamelessNanashi>)
