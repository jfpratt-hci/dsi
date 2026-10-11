-- Plate tracker: clips recorded in the browser come out as WebM on Chrome and Android (MP4 on iPhone).
-- Let them attach to PRs as video proof like an uploaded MP4.
update storage.buckets
   set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm']
 where id = 'lift-videos';
