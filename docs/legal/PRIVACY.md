# Privacy Policy

Effective date: August 9, 2026

Operator: NamelessNanashi

Contact: Nanashi@NamelessNanashi.dev

This Policy explains what NamelessPronouns collects, why it is used, who
receives it, and how long it is kept.

## 1. Information collected

### Account and profile information

We collect:

- Email address, password hash, signup reason, approval status, 18-or-older
  attestation, and policy acceptance.
- Selected 2FA method, encrypted TOTP secret, hashed recovery codes, login and
  password-reset challenges, and sessions.
- Profile usernames, display names, names, pronouns, descriptions, identity
  notes, themes, HTTPS links, avatar-source selection, and any uploaded avatar
  `data:` URI. Personal workspace ownership and membership records are used
  internally to associate an account with its profile. Shared workspaces and
  invitations are not currently offered.
- Support requests, reports, appeals, recovery cases, moderation records, bans,
  and staff audit events.
- Rights complaints and counter-notices, legal requests and disclosures,
  legal holds, export and deletion requests, incident records, and notices.
- Automated content flags, encrypted attempted profile values, matched fields
  and rule versions, warnings, suspension state, review requests, decisions,
  and exemptions.

We do not store plaintext passwords, email codes, recovery codes, or plaintext
login, password-reset, email-change, recovery, or export capability tokens. Keyed hashes or
other verification records are stored where needed to validate expiring
credentials.

Profile content may reveal sensitive identity information. You choose what to
provide and an authorized workspace member chooses whether to publish it.

### Network, security, and analytics information

We may collect IP addresses or prefixes, keyed IP hashes, Cloudflare headers,
country, user agent, timestamps, requested routes, security events, essential
cookie state, and ALTCHA proof information. ALTCHA proof-of-work and displayed
email-address obfuscation use self-hosted browser assets; the obfuscation payload
does not contain the plaintext address. Before site access, a signed
essential cookie records the Terms version, Privacy version, 18-or-older
attestation, acceptance time, and a random nonce. It does not contain an
account or profile identifier and expires after one year.

Cloudflare edge Analytics processes traffic, bandwidth, country, cache, error,
and security information for proxied requests.

Cloudflare Web Analytics and RUM may run on the consent screen, public profiles,
informational pages, and legal pages, including before acceptance. They may
process page views, performance timing, Core Web
Vitals, host, path, referrer, country, browser, operating system, device type,
and navigation type. The beacon sends metrics to `/cdn-cgi/rum` without an
analytics cookie.

RUM is excluded from signup, login, verification, 2FA, recovery, account,
dashboard, workspace, private-preview, report, and administration routes.

Transactional email sends the recipient address and fixed message content to
Resend for delivery. The application does not currently receive or store Resend
webhook events. Resend may process delivery metadata under its own terms and
privacy documentation.

## 2. How information is used

We use information to:

- Review signup requests and manage accounts.
- Authenticate users and secure sessions.
- Operate personal profiles and their internal ownership records.
- Send verification, 2FA, invitation, security, and moderation email.
- Enforce content rules, rate limits, signup restrictions, and bans.
- Investigate abuse, reports, appeals, and recovery requests.
- Maintain security, audit records, backups, reliability, and accessibility.
- Measure aggregate traffic and public-page performance through Cloudflare.
- Meet legal obligations and respond to lawful requests.

We do not sell personal information. We do not use targeted advertising,
session replay, cross-site behavioral tracking, or advertising analytics.

Where a legal basis is required, processing is based on providing the service,
security and abuse-prevention interests, consent for optional publication,
legal obligations, or legal claims.

## 3. Public information

Published profiles, including the selected avatar, are available at
`/u/<username>` to visitors who complete
the policy and age gate. Visitors, search engines that can pass the gate, and
archives may copy or retain them. Unpublishing removes the profile from
NamelessPronouns but cannot remove copies controlled by others.

Emails, private drafts, workspace membership, authentication records, support
notes, report identities, and staff records are not public profile data.

## 4. Service providers

Information may be processed by:

- Cloudflare for DNS, TLS, Tunnel, security, traffic Analytics, Web Analytics,
  RUM, and D1 when enabled.
- Resend for transactional email.
- Gravatar, only when an account selects it as the avatar source. The browser
  sends Gravatar an MD5 hash of the normalized account email as part of the
  image URL, along with ordinary request metadata such as the IP address and
  user agent. The raw email address is not placed in the URL.
- The hosting provider and Docker-managed PostgreSQL environment.
- Authorized staff according to their permissions.
- Authorities or advisers when required by law or needed to protect rights and
  safety.

Information may be processed in locations used by these providers and the
configured deployment. Appropriate transfer safeguards are used where required.

## 5. Cookies

Essential cookies support login sessions, CSRF protection, 2FA state, and
browser-bound magic links. The site-wide policy and age cookie is also
essential because the service may not be accessed without it. These cookies
are not used for advertising or cross-site tracking.

Cloudflare Web Analytics and RUM use a browser beacon without analytics cookies.
The Copy pronouns action runs locally and sends no custom analytics event.

## 6. Government and legal requests

NamelessNanashi reviews each government and law-enforcement request for legal
authority, jurisdiction, scope, and binding effect. Private account information
is not voluntarily disclosed in response to an informal request.

A judicial warrant signed by a judge will be honored only when required by law
and only for information within its valid scope. NamelessNanashi will refuse a
non-binding administrative warrant, detainer, demand, or similar document that
is not signed by a judge.

Some legal process that is not called a warrant, including a subpoena or court
order, may still be legally binding. NamelessNanashi will comply only to the
extent required by applicable law and will seek to reject, narrow, or challenge
process that is invalid, non-binding, defective, overbroad, or outside the
issuing authority's jurisdiction when reasonably possible.

The affected user will be notified before disclosure unless notice is legally
prohibited. If notice is temporarily prohibited, notice will be provided after
the restriction ends when legally permitted.

Requests are accepted at Nanashi@NamelessNanashi.dev. Requester identity and
authority are verified through an independent official channel. The service
records the request, review, preservation scope, decision, fields disclosed,
recipient, legal authority, staff actor, and user-notice status. An annual
aggregate transparency summary may report broad request counts and outcomes
when doing so is lawful and does not materially risk identifying a person.

## 7. Retention

- Pending username claims: until signup approval or denial.
- Login codes, magic links, and challenges: 10 minutes, followed by cleanup.
- Sessions: up to 30 days, expiring after 12 hours of inactivity.
- Self-service password-reset challenge records: active for ten minutes and
  removed by scheduled maintenance after expiry.
- Site-wide acceptance cookie: up to 1 year in the accepting browser.
- Account exports are generated in memory on demand and are not stored as ZIP
  archives by the application. Emailed export-link records contain a keyed token
  hash and timestamps. An unused record expires 14 days after creation; first
  use changes its expiry to seven days after that use. Expired records are
  removed by scheduled maintenance.
- Account deletion requests: 30-day grace period, then eligible live data is
  purged or pseudonymized and a minimal completion record remains.
- Security and staff audit events, ban records, recovery cases, content flags,
  reviews, exemptions, and suspension records are retained while needed for
  security, abuse prevention, accountability, support, or legal claims. The
  application does not currently apply an automatic age-based purge to these
  categories.
- Rights complaints, counter-notices, support correspondence, legal requests,
  and incident material sent by email may remain in the operator's and email
  provider's systems while needed to handle the matter, prevent abuse, meet a
  legal duty, or establish or defend a claim.
- Legal requests, disclosures, and legal holds: for the period required by law,
  an active hold, or related legal claims, followed by deletion or
  anonymization when no longer necessary.
- Encrypted database backups: the operational rotation retains at least 30
  daily archives. Data removed from the live database may therefore remain in
  encrypted backups until those archives rotate out or are otherwise deleted.
- Cloudflare, Resend, Gravatar, and infrastructure providers retain provider-side
  records according to their own current policies and legal obligations. Their
  retention is not controlled by the application.

Retention may be extended for an open appeal, abuse prevention, legal claims,
or a legal hold. Where no fixed period is stated, necessity is reviewed and the
data is deleted or anonymized when it is no longer needed for the stated purpose.

## 8. Security

Security measures include Argon2id password hashing, mandatory 2FA, encrypted
TOTP secrets, hashed one-time credentials, secure cookies, CSRF protection,
ALTCHA, rate limits, staff permissions, scoped bans, audit logging, restricted
database access, and encrypted backups.

No system is perfectly secure. Protect your email account, password, TOTP
device, recovery codes, and sessions.

## 9. Your rights and choices

Depending on applicable law, you may request access, correction, export,
deletion, restriction, or objection. You may withdraw publication consent by
unpublishing or deleting content. You may also complain to the privacy authority
where you live.

Send requests to Nanashi@NamelessNanashi.dev. Identity verification may be
required. Some security, ban, audit, backup, and legal records cannot be deleted
immediately.

## 10. Account deletion

Deleting an account immediately unpublishes its personal profile and starts
a 30-day grace period. A user may cancel during that period after fresh login
and 2FA. After 30 days, eligible account and content data is purged or
pseudonymized in the live database unless a legal hold applies.

An account export is generated on demand as a ZIP containing user-friendly
UTF-8 plain-text files and machine-readable JSON files for eligible account,
profile, policy-acceptance, internal workspace, username-claim, and audit data.
The application does not store the ZIP. Direct downloads require a signed-in
account and fresh authentication. An emailed reusable capability link is valid
for 14 days before first use and then for seven days after first use. The link
does not require login, but the site-wide policy and age gate still applies.
Possession of the link grants download access during its validity, so it should
be treated as sensitive. Exports exclude password hashes, authentication
secrets, sessions, bans, and encrypted moderation evidence. Because audit data
is included when the account is the actor or subject, it may contain internal
event identifiers and limited event details.

## 11. Adults only

People under 18 may not access or use the service, including viewing profiles,
creating accounts, accepting invitations, submitting content, or publishing.
Signup records an 18-or-older attestation without requesting a date of birth.

The service is adults-only because the operator does not welcome minors and
does not want the legal and operational burdens associated with serving them.
This restriction does not permit NSFW, NSFL, sexual, pornographic, graphic, or
other adult content, all of which remains prohibited.

If we learn that an account user is under 18, the account will be disabled and
associated information deleted, subject to required security, abuse-prevention,
legal, and backup retention.

Every visitor must agree to the current Terms and this Policy and attest that
they are at least 18 before accessing any other page. The consent screen,
Terms, this Policy, legal-request notice, and operator contact remain available
before acceptance. Cloudflare Analytics and RUM may process those visits. We do
not collect a date of birth.

## 12. Security incidents

If a security incident creates a material risk to affected users, we will
notify them without unreasonable delay and within any shorter period required
by law. Notices describe the event, relevant dates, affected data categories,
likely impact, our response, recommended user actions, and contact information.
We may send updates as the investigation develops and may delay details that
would worsen an active attack or when law prohibits disclosure.

## 13. Automated controls

ALTCHA, rate limits, bans, username checks, email-domain rules, content rules,
and security controls may automatically allow, delay, block, flag, warn, or
revert an action. Repeated matching submissions after warnings, or a critical
match, may automatically suspend normal account access, revoke sessions,
unpublish personal profiles, and restrict the account pending review.
Administrator and Owner accounts are excluded from automatic detector
suspension, but their attempted matching values are still flagged, encrypted,
retained, and available for authorized review. Their self exemptions and each
use are audited.
Administrators and Owners may review the exact attempted values behind a
content flag. Users may request Administrator review of a possible false
positive through the restricted suspension screen. Staff decide signup
approval, moderation appeals, content-flag reviews, and discretionary recovery
requests.

## 14. Changes and contact

Material changes to this Policy will be announced through the service or
verified email.

Questions and privacy requests: Nanashi@NamelessNanashi.dev
