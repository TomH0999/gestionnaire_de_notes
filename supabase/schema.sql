-- =============================================================================
-- Gestionnaire de notes BUT1 — schéma Supabase
--
-- À coller tel quel dans Supabase : SQL Editor → New query → Run.
-- Idempotent : peut être relancé sans risque (aucune donnée supprimée).
--
-- Modèle : une table générique `items` (une ligne = une note, un devoir ou un réglage),
-- identifiants UUID générés côté client, suppression logique (deleted_at), horodatage
-- serveur (updated_at) posé par trigger, RLS stricte : chaque utilisateur ne voit et ne
-- modifie que ses propres lignes.
-- =============================================================================

create table if not exists public.items (
    user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
    id                uuid        not null,
    collection        text        not null,
    data              jsonb       not null default '{}'::jsonb,
    deleted_at        timestamptz,
    client_updated_at timestamptz not null default now(),
    device_id         text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    primary key (user_id, id),
    constraint items_collection_check check (collection in ('grades', 'homework', 'settings')),
    constraint items_data_object_check check (jsonb_typeof(data) = 'object'),
    constraint items_data_size_check check (pg_column_size(data) <= 100000),
    constraint items_device_id_check check (device_id is null or char_length(device_id) <= 100)
);

comment on table public.items is 'Données de l''application (notes, devoirs, réglages) — une ligne par entrée, suppression logique.';
comment on column public.items.updated_at is 'Horloge SERVEUR (trigger) : ordre des versions et curseur de synchronisation.';
comment on column public.items.client_updated_at is 'Horodatage d''édition de l''appareil (corrigé, plafonné à now() + 1 min) : départage des vrais conflits.';

-- Rattrapage incrémental : WHERE user_id = … AND updated_at >= … ORDER BY updated_at, id
create index if not exists items_user_updated_idx on public.items (user_id, updated_at, id);

-- -----------------------------------------------------------------------------
-- Trigger : horodatage serveur, champs immuables, plafonnement de l'horloge client
-- -----------------------------------------------------------------------------
create or replace function public.items_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        new.updated_at := clock_timestamp();
        new.created_at := new.updated_at;
    else
        -- Strictement croissant pour une même ligne (même si l'horloge recule d'un cheveu)
        new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
        new.created_at := old.created_at;
        new.user_id := old.user_id;
        new.id := old.id;
    end if;
    new.client_updated_at := least(coalesce(new.client_updated_at, new.updated_at), new.updated_at + interval '1 minute');
    return new;
end;
$$;

drop trigger if exists items_before_write on public.items;
create trigger items_before_write
    before insert or update on public.items
    for each row execute function public.items_before_write();

-- -----------------------------------------------------------------------------
-- Sécurité : RLS stricte (user_id = auth.uid()), aucun accès anonyme,
-- pas de suppression physique (aucune politique DELETE, aucun droit DELETE).
-- -----------------------------------------------------------------------------
alter table public.items enable row level security;

drop policy if exists items_select_own on public.items;
create policy items_select_own on public.items
    for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists items_insert_own on public.items;
create policy items_insert_own on public.items
    for insert to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists items_update_own on public.items;
create policy items_update_own on public.items
    for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

revoke all on table public.items from public;
revoke all on table public.items from anon;
revoke all on table public.items from authenticated;
grant select, insert, update on table public.items to authenticated;

-- -----------------------------------------------------------------------------
-- Heure du serveur : permet à chaque appareil de mesurer le décalage de son horloge
-- avant de départager un conflit (appareil en avance / en retard).
-- -----------------------------------------------------------------------------
create or replace function public.server_time()
returns timestamptz
language sql
volatile
security invoker
set search_path = ''
as $$
    select clock_timestamp();
$$;

revoke all on function public.server_time() from public;
revoke all on function public.server_time() from anon;
grant execute on function public.server_time() to authenticated;

-- -----------------------------------------------------------------------------
-- Temps réel : diffusion des changements (filtrés par la RLS pour chaque abonné)
-- -----------------------------------------------------------------------------
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
       ) then
        alter publication supabase_realtime add table public.items;
    end if;
end;
$$;
