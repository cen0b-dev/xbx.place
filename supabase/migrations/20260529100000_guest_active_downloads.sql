-- Guest downloads: one active transfer at a time (row cleared when stream ends or after stale timeout).
comment on table public.guest_downloads is
  'Current active guest download per browser id. Proxy upserts on stream start and deletes on completion; stale rows expire after several hours.';
