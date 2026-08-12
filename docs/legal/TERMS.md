# Terms of Service

Effective date: August 11, 2026

Operator: NamelessNanashi

Contact: Nanashi@NamelessNanashi.dev

These Terms apply to NamelessPronouns, including public profiles, accounts,
data exports, and administration features. Before accessing the service, you
must affirmatively agree to these Terms and the Privacy Policy and confirm that
you are at least 18. The policy pages remain available so you can review them
before deciding.

## 1. Adults only

You must be at least 18 years old to access or use any part of the service,
including viewing public profiles. People under 18 are prohibited from using
the service.

This age restriction does not mean adult content is allowed. The operator does
not like serving children, does not welcome minors here, and does not want the
legal and operational burdens associated with allowing minors to use the
service. If you are under 18, leave and do not return.

By submitting a signup request, you confirm that you are at least 18. An
underage signup or account may be denied, disabled, and deleted.

The service records your browser acceptance in an essential signed cookie for
one year. A new browser, cleared or expired cookie, or policy update requires
acceptance again. Cloudflare Analytics and RUM may process the consent request
and policy-page visits before you submit acceptance. If you do not agree or
cannot truthfully confirm that you are at least 18, do not access the service.

## 2. Signup and accounts

Signup is restricted and approval is not guaranteed. An Administrator or Owner
may approve, deny, or leave a request pending without disclosing the reason.

Your selected initial profile username is held while your request is pending.
It becomes your initial profile username if approved and is released if denied.

You must provide a working email address and protect your password, email
account, second factor, recovery codes, and sessions. Every login requires a
password and either an email code or TOTP.

If you retain access to both your verified mailbox and configured second factor,
you may use self-service password reset. A successful reset signs out all
sessions. Lost-factor administrative recovery is case-by-case,
denial-by-default, and not guaranteed. Do not rely on it to regain access.

## 3. Profiles

Every public profile uses `/u/<username>` from one global username namespace.
Each approved account currently receives a personal profile. The application
uses a personal workspace record internally to own that profile. Collaborative
profile management is not offered.

Published profiles are visible to visitors who complete the policy and age
gate. Every page of the service is sent with instructions asking search engines
not to index or archive it, but those instructions are voluntary and cannot stop
copying. Other people may copy, screenshot, index, archive, or redistribute
public content. Do not publish another person's information without
permission.

An unpublished profile is not shown to the public. Exactly two kinds of viewer
can open it at its username address: the account that owns that profile, and
authorized staff acting on moderation. Being signed in to some other account
grants nothing here. You can preview your own unpublished profile, you cannot
open anyone else's, and a request from any other account or from a signed-out
browser receives the same not-found response as an address that never
existed.

## 4. Content rules

Short display fields may contain only ASCII letters, digits, and spaces. Longer
prose fields also allow a limited set of ordinary English punctuation. Profile
links must use validated HTTPS URLs.

The About me and Identity notes fields accept a limited set of Markdown
formatting: bold, italics, underline, strikethrough, inline code, headings,
bulleted lists, and block quotes. Administrator and Owner accounts may also use
hyperlinks, numbered, nested and task lists, definition lists, footnotes,
tables, fenced code blocks, horizontal rules, automatic linking of HTTPS
addresses, headings that carry their own link, images from any HTTPS address,
and ordinary HTML markup including embedded video, audio, and HTTPS frames.
Markdown that is not supported is displayed exactly as you typed it, and a
backslash keeps a formatting character literal.

Hyperlinks written inside About me or Identity notes are limited to
Administrator and Owner accounts and must be HTTPS. Every account can add links
through the Links section of the profile editor, which requires validated HTTPS
URLs. Submitting a hyperlink in a prose field without that permission is
rejected.

Administrator and Owner accounts may also submit code that runs in a viewer's
browser: `script` blocks, event-handler attributes such as `onclick`,
`javascript:` addresses, plugin objects, and forms. Every other account cannot;
for those accounts scripts, handlers, `javascript:` addresses, plugins, and
forms are removed before a profile is shown. Styling is refused at every level,
so no profile can restyle the site.

A profile page permits loading and running only what its own content refers to:
the specific HTTPS hosts it names, and code only when that profile contains it.
Every other page permits none at all. A page whose code lives entirely in
`script` blocks keeps the stricter signed-script policy; a page that uses an
event handler or a `javascript:` address relaxes that policy for itself. Addresses that are neither HTTPS nor a
path on this site are refused. For accounts without the wider Markdown set,
HTML tags are shown as text instead of being interpreted.

Content that an Administrator or Owner embeds from another site, such as a
picture or a video frame, is fetched by each viewer's own browser. That reveals
the viewer's address and request details to the site being embedded, which is
outside NamelessNanashi's control and is not covered by this service's
protections. The only image upload-like feature is the account avatar
tool. An avatar may use
Gravatar, a locally generated deterministic identicon, or a size-limited PNG,
JPEG, WebP, or restricted SVG `data:` URI prepared in the browser. Unsafe SVG
features are refused unless you explicitly choose to strip them; an unsafe SVG
is not previewed before that cleanup. No other user uploads are supported.

The service does not allow NSFW, NSFL, sexual, pornographic, erotic, fetish,
sexually suggestive, nude, graphic, gory, mutilation, cruelty, death, or shock
content. This prohibition applies to text, names, descriptions, links, linked
destinations, and every other use of the service. Adult-only access is an
eligibility rule, not permission to publish adult content. There are no content
warnings, hidden-page exceptions, or private exceptions.

The service may compare profile text and links against a maintained list of
prohibited words, phrases, hostnames, and URLs. A match may stop the edit,
restore the last accepted profile version, warn you, and send the attempted
content to authorized staff for review. If you continue making matching
submissions after a warning, the service may automatically suspend normal
account access, unpublish your personal profiles, and restrict you to the
review screen pending an Administrator or Owner decision. A critical match may
cause immediate suspension. Confirmed violations may lead to a longer
suspension, termination, or a ban.

Administrator and Owner accounts are not automatically suspended by this
detector. Their matching edits are still rejected, reverted, flagged, and
warned. They may create a narrow exemption for their own exact value, but that
does not change these Terms or prevent later moderation.

You may ask an Administrator to review a flag if you believe it was incorrect.
An Administrator or Owner may remove an incorrect flag or create a detector
exemption. An exemption may cover one harmless value for one account, and it may
be narrowed further to a single rule, a single field, or a single profile. An
Administrator or Owner may also exempt an entire account from the detector when
repeated false positives make narrower exemptions impractical. An exemption
corrects the automated detector only. It does not permit content prohibited by
these Terms, and content covered by an exemption may still be moderated,
removed, or acted on under these Terms.

Exemptions are staff records, not account settings. Each one names the staff
account that created it and the stated reason, may carry an expiry, and may be
edited, narrowed, widened, or revoked at any time. We email the affected account
when staff create, change, or revoke an exemption on it. Creating an exemption
is never a promise to keep it.

You keep ownership of your content. You allow NamelessNanashi to store, format,
display, moderate, and back up that content only as needed to run the service.
You must have permission to submit and publish it.

## 5. Prohibited use

Do not use the service to:

- Impersonate, deceive, defraud, harass, threaten, stalk, or exploit anyone.
- Publish private, confidential, or sensitive information without permission.
- Promote violence, abuse, discrimination, unlawful activity, or sexual
  exploitation.
- Publish, describe, solicit, promote, or link to NSFW, NSFL, sexual, nude,
  pornographic, fetish, sexually suggestive, graphic, gory, or shock content.
- Infringe copyright, trademark, privacy, publicity, or other rights.
- Evade signup restrictions, bans, rate limits, or security controls.
- Scrape, overload, disrupt, probe, or gain unauthorized access to the service.
- Send malware, phishing, spam, or malicious links.
- Abuse invitations, email, reports, recovery, or staff processes.
- Break applicable law.

## 6. Moderation and bans

Staff may review reports, public profiles, and unpublished profile pages,
unpublish content, limit features,
suspend or terminate accounts, revoke sessions, deny signup, and impose bans.
Bans may apply to users, emails, email domains, IP addresses, or CIDR ranges and
may block account access, profile viewing, or both.

Moderation decisions are discretionary. Detailed reasons and internal records
may be withheld. An appeal may be offered, but an appeal does not pause the
action.

Copyright, trademark, privacy, and impersonation complaints may be sent to
Nanashi@NamelessNanashi.dev with the affected profile, disputed material,
basis for the claim, a good-faith statement, and contact information. The
affected user may provide a counter-notice. Staff may request more information,
preserve evidence, unpublish or restore content, reject unsupported claims, and
act against repeated infringement, impersonation, fraudulent complaints, or
evasion. Submission does not guarantee a particular outcome.

## 7. Service providers and external links

The service uses Cloudflare for network delivery, security, Tunnel, traffic
Analytics, Web Analytics, RUM, and optional D1 storage. It uses Resend for
transactional email and may use Docker-managed PostgreSQL for storage. ALTCHA
proof-of-work and email-address obfuscation run from self-hosted application
assets. If you select Gravatar, your browser requests an avatar from Gravatar
using a hash derived from your normalized email address.

External profile links are outside NamelessNanashi's control. Use them at your
own risk.

## 8. Availability and account closure

The service may change, become unavailable, or be discontinued. No uptime or
data-preservation guarantee is provided.

You may request an account export or account deletion. Each export ZIP is
generated on demand and contains both user-friendly plain-text files and
machine-readable JSON files. A direct download requires a signed-in account and
fresh authentication. You may instead request an emailed capability link. That
link is reusable, expires 14 days after it is issued if never used, and remains
valid for seven days after its first successful use even if first used near the
end of the initial 14-day period. Anyone possessing a still-valid link can
download the export, but must first complete the current Terms, Privacy, and
18-or-older gate. Protect and delete the link when finished.

Deletion immediately unpublishes eligible content and has a 30-day cancellation
period. Your email address is kept unchanged during that period so the account
stays reachable and the deletion stays cancellable. After it ends, the account
record and its email address are deleted from the live database along with
eligible live data, rather than replaced with a placeholder address. Some
security, moderation, ban, backup, dispute, and legal records may remain under
the Privacy Policy, with the account identifier replaced by a pseudonym.

## 9. Government and legal requests

NamelessNanashi requires valid and binding legal process before disclosing
private account information to a government or law-enforcement agency.
Judge-signed judicial warrants will be honored only when required by law and
only to the scope legally required.

NamelessNanashi will refuse informal requests and non-binding administrative
warrants, detainers, demands, or similar documents that are not signed by a
judge. Other process, including a subpoena or court order, will be honored only
when it is legally binding. The Privacy Policy explains this process.

## 10. Disclaimers and liability

The service is provided as is and as available. To the extent allowed by law,
NamelessNanashi disclaims warranties of availability, accuracy, security,
fitness for a particular purpose, merchantability, and noninfringement.

To the extent allowed by law, NamelessNanashi is not liable for indirect,
incidental, special, consequential, exemplary, or punitive damages, or for loss
of data, access, reputation, revenue, or profits. Rights that cannot legally be
limited remain unaffected.

## 11. Changes

These Terms may be updated. Material changes will be announced through the
service or verified email. Renewed acceptance may be required before continued
account use.

## 12. Contact

NamelessNanashi

Nanashi@NamelessNanashi.dev
