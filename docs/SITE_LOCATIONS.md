# Site districts and talukas/cities

Apply `supabase/migrations/20261016110000_site_district_and_locality.sql` to the target database before releasing this frontend. The Sites and Overview queries require its new columns and tables.

The migration seeds seven districts and a city with the same name in each district. Managers can add more districts and talukas/cities from the site form. Names are matched without case or repeated whitespace differences. A locality belongs to one district; the same locality name can exist in different districts.

Also apply `20261016130000_reconcile_site_locations.sql`. It saves legacy text in `location_original_city`, then maps exact seeded city names and clear variants such as `RAJKOT, GUJARAT` to canonical locations. Other legacy labels require a district and locality assignment through the site form.

Edit an existing site to select its district and taluka/city. An existing locality is reused; new districts and localities can be added through the site form. The bulk location review screen has been removed.

Names are checked in the UI and database after removing case/spacing differences, a trailing Gujarat label, and administrative prefixes such as `Dist.` or `Tal-`. District-only labels are rejected as new locality names. Actual areas remain distinct: `Ring Road, Surat` is not automatically merged with `Surat`. The same locality name may exist in different districts.

When editing a site, select its district and taluka/city before saving. The database verifies the pair and keeps `sites.city` equal to the selected locality name so existing reports continue to use it.

Both Sites and Overview provide district and taluka/city filters. Changing the district resets the city filter; Overview totals, rows, and exports use the active district filter.

Apply `20261016160000_qualify_rajkot_localities.sql` to label the Rajkot localities as `Lodhika (Rajkot)` and `Kotda Sangani (Rajkot)`. Renaming a locality now synchronizes every linked company's city. The qualified names and older plain/prefixed names match the same filter value. This matching is shared by Sites, Overview, Reports, Factory Data, and Logistics. Logistics uses the matched company's city first, with its delivery-address parser as a fallback for orders without a company match.

Run the database and filter checks with:

```powershell
node --experimental-strip-types --test tests/site-location.test.mjs tests/site-location-reconciliation.test.mjs src/utils/overview-filters.test.mjs
```

After applying the migration, verify creating a site, adding a district and locality, reviewing an existing site, and combining district/city filters in both screens with a manager account.
