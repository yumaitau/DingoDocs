import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { hasPermission, type Role } from "@/lib/permissions/matrix";
import { listPortalEngagements } from "./client-portal";

export type SearchActor = {
  organisationId: string;
  userId: string;
  role: string;
};
export type GlobalSearchResult = {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  rank: number;
};

export async function globalSearch(
  actor: SearchActor,
  rawQuery: string,
  limit = 30,
): Promise<GlobalSearchResult[]> {
  const query = rawQuery.trim().slice(0, 200);
  if (query.length < 2) return [];
  const capped = Math.max(1, Math.min(limit, 100));
  if (actor.role === "client_user" || actor.role === "client_administrator")
    return clientSearch(actor, query, capped);
  const canViewRestricted = hasPermission(
    actor.role as Role,
    "evidence:view_restricted",
  );
  const result = await db.execute<GlobalSearchResult>(sql`
    with q as (select websearch_to_tsquery('simple', ${query}) query), results as (
      select 'client' type, c.id::text id, c.name title, coalesce(c.industry,'Client') subtitle, '/clients/'||c.id::text href, ts_rank(to_tsvector('simple', coalesce(c.name,'')||' '||coalesce(c.legal_name,'')||' '||coalesce(c.industry,'')), q.query) rank from clients c, q where c.organisation_id=${actor.organisationId} and c.deleted_at is null and to_tsvector('simple', coalesce(c.name,'')||' '||coalesce(c.legal_name,'')||' '||coalesce(c.industry,'')) @@ q.query
      union all select 'engagement', e.id::text, e.name, e.reference||' · '||e.type, '/engagements/'||e.id::text, ts_rank(to_tsvector('simple', coalesce(e.name,'')||' '||coalesce(e.reference,'')||' '||coalesce(e.objectives,'')), q.query) from engagements e,q where e.organisation_id=${actor.organisationId} and e.deleted_at is null and to_tsvector('simple', coalesce(e.name,'')||' '||coalesce(e.reference,'')||' '||coalesce(e.objectives,'')) @@ q.query
      union all select 'finding', f.id::text, f.identifier||' · '||f.title, f.severity::text||' · '||f.status::text, '/engagements/'||f.engagement_id::text||'?view=findings', ts_rank(to_tsvector('simple', coalesce(f.title,'')||' '||coalesce(f.identifier,'')||' '||coalesce(f.executive_summary,'')||' '||coalesce(f.technical_detail,'')||' '||coalesce(f.remediation,'')), q.query) from findings f,q where f.organisation_id=${actor.organisationId} and f.deleted_at is null and to_tsvector('simple', coalesce(f.title,'')||' '||coalesce(f.identifier,'')||' '||coalesce(f.executive_summary,'')||' '||coalesce(f.technical_detail,'')||' '||coalesce(f.remediation,'')) @@ q.query
      union all select 'template', t.id::text, t.title, t.stable_key, '/findings-library', ts_rank(to_tsvector('simple', coalesce(t.title,'')||' '||coalesce(t.summary,'')||' '||coalesce(t.technical_description,'')||' '||array_to_string(t.tags,' ')), q.query) from finding_templates t,q where t.organisation_id=${actor.organisationId} and to_tsvector('simple', coalesce(t.title,'')||' '||coalesce(t.summary,'')||' '||coalesce(t.technical_description,'')||' '||array_to_string(t.tags,' ')) @@ q.query
      union all select 'asset', a.id::text, a.name, a.identifier, '/engagements/'||a.engagement_id::text||'?view=assets', ts_rank(to_tsvector('simple', coalesce(a.name,'')||' '||coalesce(a.identifier,'')||' '||coalesce(a.notes,'')), q.query) from assets a,q where a.organisation_id=${actor.organisationId} and a.deleted_at is null and to_tsvector('simple', coalesce(a.name,'')||' '||coalesce(a.identifier,'')||' '||coalesce(a.notes,'')) @@ q.query
      union all select 'scope', s.id::text, s.name, s.value, '/engagements/'||s.engagement_id::text||'?view=scope', ts_rank(to_tsvector('simple', coalesce(s.name,'')||' '||coalesce(s.value,'')||' '||coalesce(s.notes,'')), q.query) from scope_items s,q where s.organisation_id=${actor.organisationId} and to_tsvector('simple', coalesce(s.name,'')||' '||coalesce(s.value,'')||' '||coalesce(s.notes,'')) @@ q.query
      union all select 'evidence', ev.id::text, ev.original_filename, ev.media_type, '/api/v1/evidence/'||ev.id::text||'/preview', ts_rank(to_tsvector('simple', coalesce(ev.original_filename,'')||' '||coalesce(ev.media_type,'')||' '||coalesce(ev.sha256,'')), q.query) from evidence ev,q where ev.organisation_id=${actor.organisationId} and ev.deleted_at is null and (${canViewRestricted} or ev.classification <> 'restricted' or ev.uploaded_by=${actor.userId} or coalesce(ev.restrictions->'userIds','[]'::jsonb) ? ${actor.userId}) and to_tsvector('simple', coalesce(ev.original_filename,'')||' '||coalesce(ev.media_type,'')||' '||coalesce(ev.sha256,'')) @@ q.query
      union all select 'report', r.id::text, r.title, r.status::text, '/reports/'||r.id::text, ts_rank(to_tsvector('simple', coalesce(r.title,'')), q.query) from reports r,q where r.organisation_id=${actor.organisationId} and to_tsvector('simple',coalesce(r.title,'')) @@ q.query
      union all select 'note', n.id::text, n.title, n.kind, '/engagements/'||n.engagement_id::text||'?view=notes', ts_rank(to_tsvector('simple', coalesce(n.title,'')||' '||coalesce(n.content::text,'')), q.query) from notes n,q where n.organisation_id=${actor.organisationId} and n.deleted_at is null and to_tsvector('simple', coalesce(n.title,'')||' '||coalesce(n.content::text,'')) @@ q.query
      union all select 'task', t.id::text, t.title, t.status::text, '/tasks', ts_rank(to_tsvector('simple', coalesce(t.title,'')||' '||coalesce(t.description,'')), q.query) from tasks t,q where t.organisation_id=${actor.organisationId} and to_tsvector('simple',coalesce(t.title,'')||' '||coalesce(t.description,'')) @@ q.query
      union all select 'person', u.id::text, u.name, u.email, '/team', ts_rank(to_tsvector('simple', coalesce(u.name,'')||' '||coalesce(u.email,'')), q.query) from organisation_members m join users u on u.id=m.user_id,q where m.organisation_id=${actor.organisationId} and m.deleted_at is null and to_tsvector('simple',coalesce(u.name,'')||' '||coalesce(u.email,'')) @@ q.query
    ) select * from results order by rank desc, title asc limit ${capped}
  `);
  return [...result];
}

async function clientSearch(actor: SearchActor, query: string, limit: number) {
  const allowed = await listPortalEngagements(actor);
  const engagementIds = allowed.map((item) => item.id);
  if (!engagementIds.length) return [];
  const ids = sql`(${sql.join(
    engagementIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
  const result = await db.execute<GlobalSearchResult>(sql`
    with q as (select websearch_to_tsquery('simple', ${query}) query), results as (
      select 'engagement' type, e.id::text id, e.name title, e.reference||' · '||e.type subtitle, '/portal/engagements/'||e.id::text href, ts_rank(to_tsvector('simple',coalesce(e.name,'')||' '||coalesce(e.reference,'')||' '||coalesce(e.objectives,'')),q.query) rank from engagements e,q where e.organisation_id=${actor.organisationId} and e.id in ${ids} and e.deleted_at is null and to_tsvector('simple',coalesce(e.name,'')||' '||coalesce(e.reference,'')||' '||coalesce(e.objectives,'')) @@ q.query
      union all select 'finding', f.id::text, f.identifier||' · '||f.title, f.severity::text||' · '||f.status::text, '/portal/engagements/'||f.engagement_id::text, ts_rank(to_tsvector('simple',coalesce(f.title,'')||' '||coalesce(f.identifier,'')||' '||coalesce(f.executive_summary,'')||' '||coalesce(f.remediation,'')),q.query) from findings f,q where f.organisation_id=${actor.organisationId} and f.engagement_id in ${ids} and f.client_visible=true and f.published_at is not null and f.deleted_at is null and to_tsvector('simple',coalesce(f.title,'')||' '||coalesce(f.identifier,'')||' '||coalesce(f.executive_summary,'')||' '||coalesce(f.remediation,'')) @@ q.query
      union all select 'scope', s.id::text, s.name, s.value, '/portal/engagements/'||s.engagement_id::text, ts_rank(to_tsvector('simple',coalesce(s.name,'')||' '||coalesce(s.value,'')||' '||coalesce(s.testing_restrictions,'')),q.query) from scope_items s join scope_versions sv on sv.id=s.scope_version_id,q where s.organisation_id=${actor.organisationId} and s.engagement_id in ${ids} and sv.status='approved' and to_tsvector('simple',coalesce(s.name,'')||' '||coalesce(s.value,'')||' '||coalesce(s.testing_restrictions,'')) @@ q.query
      union all select 'evidence', ev.id::text, ev.original_filename, ev.media_type, '/api/v1/evidence/'||ev.id::text||'/preview', ts_rank(to_tsvector('simple',coalesce(ev.original_filename,'')||' '||coalesce(ev.media_type,'')||' '||coalesce(ev.sha256,'')),q.query) from evidence ev join engagements ge on ge.id=ev.engagement_id and ge.client_id=ev.client_id and ge.organisation_id=ev.organisation_id,q where ev.organisation_id=${actor.organisationId} and ev.engagement_id in ${ids} and ev.classification='client_visible' and ev.deleted_at is null and ev.quarantined_at is null and to_tsvector('simple',coalesce(ev.original_filename,'')||' '||coalesce(ev.media_type,'')||' '||coalesce(ev.sha256,'')) @@ q.query
      union all select 'report', rv.id::text, r.title, rv.status::text, '/api/portal/reports/'||rv.id::text||'/preview', ts_rank(to_tsvector('simple',coalesce(r.title,'')),q.query) from reports r join report_versions rv on rv.report_id=r.id join engagements ge on ge.id=r.engagement_id and ge.client_id=r.client_id and ge.organisation_id=r.organisation_id,q where r.organisation_id=${actor.organisationId} and r.engagement_id in ${ids} and rv.client_visible=true and rv.status in ('client_review','approved','published','superseded') and to_tsvector('simple',coalesce(r.title,'')) @@ q.query
      union all select 'task', t.id::text, t.title, t.status::text, '/portal/engagements/'||t.engagement_id::text, ts_rank(to_tsvector('simple',coalesce(t.title,'')||' '||coalesce(t.description,'')),q.query) from tasks t,q where t.organisation_id=${actor.organisationId} and t.engagement_id in ${ids} and t.client_visible=true and to_tsvector('simple',coalesce(t.title,'')||' '||coalesce(t.description,'')) @@ q.query
    ) select * from results order by rank desc,title asc limit ${limit}
  `);
  return [...result];
}
