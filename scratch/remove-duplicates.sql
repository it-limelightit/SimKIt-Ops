-- 1. View duplicate site entries (group by name and city)
SELECT name, city, COUNT(*) 
FROM public.sites 
GROUP BY name, city 
HAVING COUNT(*) > 1;

-- 2. Delete duplicate entries, keeping only the first one created
DELETE FROM public.sites a
USING public.sites b
WHERE a.id > b.id
  AND LOWER(TRIM(a.name)) = LOWER(TRIM(b.name))
  AND LOWER(TRIM(a.city)) = LOWER(TRIM(b.city));
