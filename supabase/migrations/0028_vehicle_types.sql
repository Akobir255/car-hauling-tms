-- Auto transport is not only cars. Brokers quote boats, motorhomes, ATVs and
-- trailers regularly, and each one prices and loads differently — a boat needs
-- its beam measured, an RV rarely fits an open trailer, a non-running ATV is a
-- winch job. Filing all of them under "Other" loses that at the point the rate
-- is set.
--
-- ALTER TYPE ... ADD VALUE is committed here and used from the application in
-- a later statement: Postgres will not let a new enum label be referenced in
-- the same transaction that creates it.

alter type vehicle_type add value if not exists 'boat';
alter type vehicle_type add value if not exists 'rv';
alter type vehicle_type add value if not exists 'atv';
alter type vehicle_type add value if not exists 'trailer';
alter type vehicle_type add value if not exists 'heavy_equipment';
