-- Match the private attachment bucket to Supabase Free's 50 MiB per-file limit.
insert into storage.buckets(id,name,public,file_size_limit)
values ('animal-attachments','animal-attachments',false,52428800)
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit;