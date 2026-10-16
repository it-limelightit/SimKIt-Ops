import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../supabase/migrations/20261016110000_site_district_and_locality.sql", import.meta.url),
  "utf8",
);

test("site locations require matching district and locality and reject case duplicates", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$;
      CREATE FUNCTION public.is_staff(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE TABLE public.sites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, city text);
      INSERT INTO public.sites(name,city) VALUES('Legacy Factory','VADODARA');
    `);
    await db.exec(migration);
    const districts = (await db.query("SELECT id,name FROM public.site_districts")).rows;
    assert.equal(districts.length, 7);
    const vadodara = districts.find((row) => row.name === "Vadodara");
    const rajkot = districts.find((row) => row.name === "Rajkot");
    await assert.rejects(db.query("INSERT INTO public.site_districts(name) VALUES('VADODARA')"), /duplicate key/);
    await db.query("INSERT INTO public.site_districts(name) VALUES('New District')");
    await assert.rejects(db.query("INSERT INTO public.site_districts(name) VALUES('NEW   DISTRICT')"), /duplicate key/);

    const vadodaraCity = (await db.query("SELECT id FROM public.site_localities WHERE district_id=$1 AND name='Vadodara'", [vadodara.id])).rows[0];
    const rajkotCity = (await db.query("SELECT id FROM public.site_localities WHERE district_id=$1 AND name='Rajkot'", [rajkot.id])).rows[0];
    await assert.rejects(db.query("INSERT INTO public.site_localities(district_id,name) VALUES($1,'vAdOdArA')", [vadodara.id]), /duplicate key/);
    await db.query("INSERT INTO public.site_localities(district_id,name) VALUES($1,'Vadodara')", [rajkot.id]);

    await assert.rejects(db.query("INSERT INTO public.sites(name,city) VALUES('Missing location','Vadodara')"), /Select a district and taluka\/city/);
    await assert.rejects(
      db.query("INSERT INTO public.sites(name,district_id,locality_id) VALUES('Wrong district',$1,$2)", [vadodara.id,rajkotCity.id]),
      /belonging to the selected district/,
    );
    await db.query("INSERT INTO public.sites(name,city,district_id,locality_id) VALUES('New Factory','VADODARA',$1,$2)", [vadodara.id,vadodaraCity.id]);
    assert.equal((await db.query("SELECT city FROM public.sites WHERE name='New Factory'")).rows[0].city, "Vadodara");

    assert.equal((await db.query("SELECT district_id FROM public.sites WHERE name='Legacy Factory'")).rows[0].district_id, null);
    await db.query("UPDATE public.sites SET name='Legacy Factory' WHERE name='Legacy Factory'");
    await assert.rejects(db.query("UPDATE public.sites SET city='Rajkot' WHERE name='Legacy Factory'"), /Select a district and taluka\/city/);
    await assert.rejects(db.query("UPDATE public.sites SET district_id=$1 WHERE name='Legacy Factory'", [vadodara.id]), /Select both district and taluka\/city/);
    await db.query("UPDATE public.sites SET district_id=$1,locality_id=$2 WHERE name='Legacy Factory'", [vadodara.id,vadodaraCity.id]);
    assert.equal((await db.query("SELECT city FROM public.sites WHERE name='Legacy Factory'")).rows[0].city, "Vadodara");
  } finally {
    await db.close();
  }
});
