-- Voice for every plan (with a daily cap so the free plan cannot create unbounded cost) and
-- "bring your own API key" for the paid plans. Idempotent.
update public.plans set limits = limits || jsonb_build_object('daily_voice',
  case id when 'free' then 30 when 'pro' then 300 when 'business' then 1500 else 10000 end)
where id in ('free', 'pro', 'business', 'enterprise');

update public.plans set features = array_append(features, 'ai_ceo_voice')
where id = 'free' and not ('ai_ceo_voice' = any(features));

update public.plans set features = array_append(features, 'byo_keys')
where id in ('pro', 'business') and not ('byo_keys' = any(features));
