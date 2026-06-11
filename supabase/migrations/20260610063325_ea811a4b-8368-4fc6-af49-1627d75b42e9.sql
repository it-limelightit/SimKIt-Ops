
-- Allow authenticated users to read/write objects in site-media and site-docs.
-- File path convention: {site_id}/{phase}/{filename}
CREATE POLICY "site files read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('site-media','site-docs')
  AND public.can_access_site(((storage.foldername(name))[1])::uuid)
);
CREATE POLICY "site files insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('site-media','site-docs')
  AND public.can_access_site(((storage.foldername(name))[1])::uuid)
);
CREATE POLICY "site files update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('site-media','site-docs')
  AND public.can_access_site(((storage.foldername(name))[1])::uuid)
);
CREATE POLICY "site files delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('site-media','site-docs')
  AND public.can_access_site(((storage.foldername(name))[1])::uuid)
);
