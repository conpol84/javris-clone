-- Interface language follows the person across devices.
alter table public.profiles
  add column if not exists locale text
  check (locale is null or locale in ('en', 'el', 'es', 'pt-BR', 'de', 'fr', 'zh-CN', 'ar'));
