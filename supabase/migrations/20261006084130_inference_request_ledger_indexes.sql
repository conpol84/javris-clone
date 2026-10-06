-- Cover both foreign-key paths reported by the production performance advisor.
-- These indexes are additive and do not change accounting admission semantics.
create index if not exists inference_requests_org_agent_idx
  on private.inference_requests (organization_id, agent_id);

create index if not exists inference_requests_user_idx
  on private.inference_requests (user_id);
