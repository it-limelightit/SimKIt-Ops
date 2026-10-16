import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { locationKey, siteCityKey, formatLocationName, isDistrictOnly, siteCityOptions, companyCityMap } from '../src/utils/site-location.ts';

const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
test('location aliases merge administrative spelling variants and preserve real areas', () => {
  assert.equal(locationKey(' Rajkot, GUJARAT '), locationKey('RAJKOT'));
  assert.equal(locationKey('DIST. SURAT'), locationKey('Surat District'));
  assert.equal(locationKey('Tal-Kotda Sangani'), locationKey(' Kotda   Sangani '));
  assert.equal(formatLocationName('RAJKOT, GUJARAT'), 'Rajkot');
  assert.equal(isDistrictOnly('Dist. Surat'), true);
  assert.notEqual(siteCityKey('DIST. SURAT'), siteCityKey('Surat'));
  assert.notEqual(siteCityKey('Ring Road, Surat'), siteCityKey('Surat'));
  assert.equal(siteCityKey('Tal-Lodhika'), siteCityKey('Lodhika (Rajkot)'));
  assert.equal(siteCityKey('Kotda Sangani'), siteCityKey('kotda sangani (rajkot)'));
  assert.equal(formatLocationName('LODHIKA (RAJKOT)'), 'Lodhika (Rajkot)');
  assert.deepEqual(siteCityOptions(['lodhika','Lodhika (Rajkot)','SURAT','Surat']), ['Lodhika (Rajkot)','Surat']);
  assert.equal(companyCityMap([{name:'Company A',company_name:'ACME',city:'Lodhika (Rajkot)'}]).get('acme'), 'Lodhika (Rajkot)');
  assert.equal(companyCityMap([{name:'ACME',city:'Surat'},{name:'acme',city:'Rajkot'}]).get('acme'), null);
});

test('reconciliation preserves original labels, enforces canonical duplicates and reviews groups atomically', async () => {
  const db = new PGlite();
  const manager = '00000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION public.is_staff(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1='${manager}'::uuid $$;
      CREATE TABLE public.sites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,city text,address text,updated_at timestamptz DEFAULT '2026-01-01T00:00:00Z');
      CREATE FUNCTION public.handle_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
      CREATE TRIGGER trigger_sites_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
      INSERT INTO public.sites(name,city,address) VALUES
      ('City A','RAJKOT','Original address'),('City B','Rajkot, Gujarat','Second address'),
      ('District only','DIST. SURAT','Keep district address'),('Area','RING ROAD, SURAT','Keep area address'),
      ('Village A','LODHIKA','Village address'),('Village B','TAL-LODHIKA','Another address');`);
    await db.exec(migration('20261016110000_site_district_and_locality.sql'));
    await db.exec(migration('20261016130000_reconcile_site_locations.sql'));
    const rows = (await db.query('SELECT * FROM public.sites ORDER BY name')).rows;
    const a = rows.find(r => r.name === 'City A'), b = rows.find(r => r.name === 'City B');
    assert.equal(a.city, 'Rajkot'); assert.equal(b.city, 'Rajkot');
    assert.equal(a.locality_id, b.locality_id);
    assert.equal(new Date(a.updated_at).toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(b.location_original_city, 'Rajkot, Gujarat'); assert.equal(a.address, 'Original address');
    assert.equal(rows.find(r => r.name === 'District only').district_id, null);
    assert.equal(rows.find(r => r.name === 'Area').district_id, null);
    const rajkot = a.district_id;
    const surat = (await db.query("SELECT id FROM public.site_districts WHERE name='Surat'")).rows[0].id;
    for (const label of ['Dist. Surat','Surat District','Surat, Gujarat','  SURAT  ']) {
      await assert.rejects(db.query('INSERT INTO public.site_districts(name) VALUES($1)', [label]), /duplicate key/);
    }
    await assert.rejects(db.query('INSERT INTO public.site_localities(district_id,name) VALUES($1,$2)', [surat,'Dist. Surat']), /select the district separately/);
    await assert.rejects(db.query('INSERT INTO public.site_localities(district_id,name) VALUES($1,$2)', [rajkot,'Rajkot, Gujarat']), /duplicate key/);
    const villages = rows.filter(r => r.name.startsWith('Village')).map(r => r.id);
    await assert.rejects(db.query('SELECT public.review_site_locations($1,$2,$3)', [villages,rajkot,'Lodhika']), /Manager access required/);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [manager]);
    await assert.rejects(db.query('SELECT public.review_site_locations($1,$2,$3)', [[villages[0],a.id],rajkot,'Lodhika']), /already been reviewed/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.site_localities WHERE name='Lodhika'")).rows[0].n, 0);
    assert.equal((await db.query('SELECT public.review_site_locations($1,$2,$3) AS n', [villages,rajkot,'Tal-Lodhika'])).rows[0].n, 2);
    const reviewed = (await db.query("SELECT * FROM public.sites WHERE name LIKE 'Village%' ORDER BY name")).rows;
    assert.equal(reviewed[0].city, 'Lodhika'); assert.equal(reviewed[1].city, 'Lodhika');
    assert.notEqual(new Date(reviewed[0].updated_at).toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(reviewed[0].locality_id, reviewed[1].locality_id);
    assert.equal(reviewed[1].location_original_city, 'TAL-LODHIKA');
    await assert.rejects(db.query('INSERT INTO public.site_localities(district_id,name) VALUES($1,$2)', [rajkot,'LODHiKA, Gujarat']), /duplicate key/);
    await db.query('INSERT INTO public.site_localities(district_id,name) VALUES($1,$2)', [surat,'Lodhika']);
    await assert.rejects(db.query('SELECT public.review_site_locations($1,$2,$3)', [villages,rajkot,'Other place']), /already been reviewed/);
    await db.exec(migration('20261016160000_qualify_rajkot_localities.sql'));
    const qualified = (await db.query("SELECT * FROM public.sites WHERE name LIKE 'Village%' ORDER BY name")).rows;
    assert.equal(qualified[0].city, 'Lodhika (Rajkot)');
    assert.equal(qualified[1].city, 'Lodhika (Rajkot)');
    assert.equal(qualified[1].location_original_city, 'TAL-LODHIKA');
    assert.equal(new Date(qualified[0].updated_at).toISOString(),new Date(reviewed[0].updated_at).toISOString());
    await assert.rejects(db.query('INSERT INTO public.site_localities(district_id,name) VALUES($1,$2)',[rajkot,'Tal-Lodhika']),/duplicate key/);
    await db.query('INSERT INTO public.site_localities(district_id,name) VALUES($1,$2)',[rajkot,'Kotda Sangani']);
    assert.equal((await db.query("SELECT name FROM public.site_localities WHERE district_id=$1 AND public.site_location_key(name)='kotda sangani'",[rajkot])).rows[0].name,'Kotda Sangani (Rajkot)');
    for (const label of ['Dist. Surat','Surat District','Rajkot, Gujarat','Tal-Kotda Sangani','Ring Road, Surat','Lodhika (Rajkot)','Kotda Sangani (Rajkot)']) {
      assert.equal((await db.query('SELECT public.site_location_key($1) AS key', [label])).rows[0].key, locationKey(label));
    }
  } finally { await db.close(); }
});
