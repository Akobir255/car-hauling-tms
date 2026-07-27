-- Per-vehicle photo override.
--
-- Vehicle thumbnails are normally resolved from make/model, which is right
-- most of the time and wrong for trim levels, customised cars, and anything
-- the lookup has never heard of. A dispatcher can upload the actual photo
-- and it wins from then on.
--
-- The file lives in the PRIVATE load-files bucket like every other upload;
-- /api/vehicles/image streams it server-side, so the bucket stays private
-- and the public contract page can still show the picture.

alter table load_vehicles
  add column if not exists photo_path text;
