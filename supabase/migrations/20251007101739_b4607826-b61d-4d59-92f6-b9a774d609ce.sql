-- Storage policies for procurement-documents bucket
-- Allow authenticated users to manage their own files under a user-id folder prefix

-- DROP existing policies if they exist
drop policy if exists "Users can read their own procurement documents" on storage.objects;
drop policy if exists "Users can upload their own procurement documents" on storage.objects;
drop policy if exists "Users can update their own procurement documents" on storage.objects;
drop policy if exists "Users can delete their own procurement documents" on storage.objects;

-- SELECT (read)
create policy "Users can read their own procurement documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'procurement-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- INSERT (upload)
create policy "Users can upload their own procurement documents"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'procurement-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE (replace/rename)
create policy "Users can update their own procurement documents"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'procurement-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'procurement-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE
create policy "Users can delete their own procurement documents"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'procurement-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );