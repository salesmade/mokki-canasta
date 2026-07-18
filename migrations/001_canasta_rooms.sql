-- Mökki-Canasta: huoneiden tila. Yksi rivi per huone, koko tila jsonb:na.
-- Palvelu käyttää service_role-avainta (ohittaa RLS), joten policyja ei tarvita.

create table if not exists canasta_rooms (
  code        text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table canasta_rooms enable row level security;

-- Vanhojen huoneiden siivousta varten (aja tarvittaessa cronilla):
--   delete from canasta_rooms where updated_at < now() - interval '1 day';
create index if not exists canasta_rooms_updated_idx on canasta_rooms (updated_at);
