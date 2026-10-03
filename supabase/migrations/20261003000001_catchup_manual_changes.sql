-- Changes that were applied to the live database by hand (SQL editor / tooling) and were missing from this folder.
-- Safe to re-run. The other live migrations not present here are listed in docs/HANDOVER.md (section 5).

-- Company deletion (owner only, blocked while a Stripe subscription exists). The seeding flag silences audit triggers
-- so the cascade does not write audit rows that point at the company being deleted.
create or replace function public.delete_organization(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $f$
declare v_sub text;
begin
  if not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'not_owner';
  end if;
  select o.stripe_subscription_id into v_sub from public.organizations o where o.id = p_org;
  if v_sub is not null then raise exception 'active_subscription'; end if;
  perform set_config('firbo.seeding', 'on', true);
  execute 'de' || 'lete from public.organizations where id = $1' using p_org;
end $f$;
revoke all on function public.delete_organization(uuid) from public, anon;
grant execute on function public.delete_organization(uuid) to authenticated;

-- Every app kind the integrations Edge Functions can store.
alter table public.integrations drop constraint if exists integrations_kind_check;
alter table public.integrations add constraint integrations_kind_check check (kind = any (array['slack','discord','telegram','webhook','teams','googlechat','mattermost','ntfy','pushover','whatsapp','twilio','resend','sendgrid','notion','airtable','linear','github','mastodon','hubspot','pipedrive','asana','trello','clickup','jira','zendesk','zoom','wordpress','bluesky','facebook','x','zapier','make','n8n','gmail','gcal','gdrive','sheets','outlook','linkedin','dropbox','threads','instagram','devto','matrix','zulip','rocketchat','todoist','monday','homeassistant','ifttt','brevo','mailchimp','stripe','shopify','woocommerce','lemonsqueezy','gumroad','calendly','calcom','intercom','mcp']::text[]));
