
DROP POLICY IF EXISTS "avatars auth read" ON storage.objects;
DROP POLICY IF EXISTS "avatars user write" ON storage.objects;
DROP POLICY IF EXISTS "avatars user update" ON storage.objects;
DROP POLICY IF EXISTS "avatars user delete" ON storage.objects;
CREATE POLICY "avatars auth read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');
CREATE POLICY "avatars user write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars user update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars user delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
