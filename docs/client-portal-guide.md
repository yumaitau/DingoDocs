# Client portal guide

Client users receive a short-lived invitation for a named email address. Sign in with that same verified address, accept the invitation once, and enable MFA or a passkey. Contact the engagement team if the invitation expires or was sent to the wrong address; links must not be forwarded.

Client access is constrained to named contacts explicitly assigned to an engagement. After signing in, use **Engagements** in the client portal to review the latest approved scope, findings that have both been published and explicitly shared, permitted report versions, and evidence classified as client visible. Draft findings, internal notes and QA comments, restricted or internal evidence, and unshared reports never appear. Client accounts and client-owned API keys cannot use organisation-wide application or REST routes.

For each shared finding, select an explicit remediation state: in progress, remediated, partially remediated, not remediated, or risk accepted. You can record the remediation owner and update note, upload client-visible remediation evidence, add a client discussion comment, and request a retest. These submissions are append-only history; a later update does not replace the earlier one.

Shared report drafts can be previewed, commented on, and approved from the portal. A client approval records the approving account and time. Published and superseded report versions remain available only while the engagement team keeps that version shared.

When a retest is requested, DingoDocs snapshots the original finding version and the latest remediation submission. The engagement team can schedule and assign the retest, attach evidence, keep internal notes separate from client-visible notes, record a comparison, and select an explicit outcome. Completing a retest versions the finding and creates a draft revision from the latest published report without changing the original report.

Use organisation-approved channels for urgent disclosure. Do not include credentials in filenames, comments, or support messages. Revoke unfamiliar sessions from **Security** and notify the engagement contact immediately.
