# User guide

Sign in with a verified email and password, magic link, passkey, or an identity provider enabled by your administrator. Passwords require at least 14 characters and breached passwords are rejected. Password-reset links expire after 30 minutes and revoke other sessions.

Open **Account security** to register a platform or hardware passkey, enrol TOTP multi-factor authentication, replace recovery codes, review browser sessions, and revoke a lost device. Store recovery codes offline; each works once and generating a new set invalidates the old set. Report an unfamiliar device and rotate credentials immediately.

Organisation access follows your assigned role. Upload only authorised evidence, apply the correct classification and retention date, and do not copy secrets into comments or filenames. Published report versions are immutable; use a new revision for later corrections. Audit records identify material changes and downloads.

Use **Imports & Exports** to stage Nmap XML, Nessus, OpenVAS, OWASP ZAP, Burp Suite, CSV, or JSON results. DingoDocs validates the selected format, preserves the original as immutable internal evidence, normalises severity and targets, and shows duplicates before any records are created. Review every row and import only the selected findings. Imported findings remain drafts and retain their adapter, external identifier, source checksum, evidence identifier, and import-run provenance.

The command palette searches clients, engagements, findings, templates, assets, scope, evidence metadata, reports, notes, tasks, and people using PostgreSQL full-text search. Client portal search is intentionally narrower: it searches only authorised engagements and explicitly published/client-visible records.
