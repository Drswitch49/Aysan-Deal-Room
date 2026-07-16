-- Deal-level "Deal Files" link → Cloudinary (rehosted from filebin/tmpfiles/Drive).
alter table deals add column if not exists deal_files_cloudinary_id text;
alter table deals add column if not exists deal_files_secure_url text;
