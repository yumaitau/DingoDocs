# User guide

Sign in with a verified email and password, magic link, passkey, or an identity provider enabled by your administrator. Passwords require at least 14 characters and breached passwords are rejected. Password-reset links expire after 30 minutes and revoke other sessions.

Open **Account security** to register a platform or hardware passkey, enrol TOTP multi-factor authentication, replace recovery codes, review browser sessions, and revoke a lost device. Store recovery codes offline; each works once and generating a new set invalidates the old set. Report an unfamiliar device and rotate credentials immediately.

Organisation access follows your assigned role. Upload only authorised evidence, apply the correct classification and retention date, and do not copy secrets into comments or filenames. Published report versions are immutable; use a new revision for later corrections. Audit records identify material changes and downloads.

Use **Imports & Exports** to stage Nmap XML, Nessus, OpenVAS, OWASP ZAP, Burp Suite, CSV, or JSON results. DingoDocs validates the selected format, preserves the original as immutable internal evidence, normalises severity and targets, and shows duplicates before any records are created. Review every row and import only the selected findings. Imported findings remain drafts and retain their adapter, external identifier, source checksum, evidence identifier, and import-run provenance.

The command palette searches clients, engagements, findings, templates, assets, scope, evidence metadata, reports, notes, tasks, and people using PostgreSQL full-text search. Client portal search is intentionally narrower: it searches only authorised engagements and explicitly published/client-visible records.

## Report templates and draft writing

Open **Templates → Open template builder**. Choose a blank, professional penetration-test, or OSAI exam layout. Drag blocks onto the page and use their handles to reorder them. **Move up/down**, duplicate, delete, undo and redo provide alternatives to dragging. Select a block to edit its title, text, exact commands, screenshot and caption. PNG/JPEG screenshots must be under 2 MB each; the complete layout is limited to 12 MB and 250 blocks. Screenshots are embedded, so saved templates and exported reports remain self-contained.

Saving an existing template creates a new template version. **Use as starting point** creates an independent template. Create a report from an engagement and template, then choose **Write report** to enter assessment-specific material. Saving a draft does not change its source template. Review/published versions cannot be edited; request changes or create a revision. Conflicting saves from another window are rejected. Saving invalidates previous exports, so queue generation again before downloading.

The Craft.js canvas edits ordered report blocks. HTML preview, PDF, Word and Markdown render those blocks using the existing report engine. It is not an arbitrary HTML importer or a pixel-identical PDF page designer. Advanced print CSS affects HTML only.

## OSAI exam reports

Select **OSAI exam report**, enter your OSID, candidate name and email, then save a reusable template. Create a report and replace starter instructions with your actual work. The starter covers the two three-host chains, shared Domain Controller, standalone AI host, summary, attack path, exploit sources/modifications, commands, proof, screenshots and AI interaction history. Add screenshot/code blocks for every relevant stage. Keep commands, queries, prompts and scripts as text, with screenshots supporting the narrative.

The preparation checklist identifies missing OSID, starter instructions and empty screenshot blocks. It cannot certify completeness or predict a score. PDF downloads use `OSAI-OS-XXXXX-Exam-Report.pdf`. Inspect every exported page and confirm that copied commands remain correct. On your Kali machine, create an unencrypted `.7z` of the same name containing only the PDF, check that the archive is no more than 100 MB, and compare its local MD5 against the portal hash after upload. Submit within 24 hours of the exam ending.

OffSec accepts a custom professional template that meets its documentation requirements. Review the [current OSAI Exam Guide](https://help.offsec.com/hc/en-us/articles/46593096734612-OSAI-Exam-Guide) before submission; the application does not submit exam files for you. This starter is independently written, not an official OffSec template.
