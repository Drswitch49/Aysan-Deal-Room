-- Repair the attachment list the IM & Attachments tab reads.
--
-- Two populations of bad data, both from the same root cause — a file name that
-- was guessed from a URL, or never captured at all.
--
-- 1. Rows named after a query string. The deal inbox's "paste a URL" box
--    labelled attachments with url.split("/").pop(), so every Google Drive
--    share link (…/file/d/<id>/view?usp=sharing) became an attachment called
--    "view?usp=sharing". A share link carries no file name, so name the host.
--
-- 2. Deals whose only IM sits in deals.deal_files_secure_url with no matching
--    im_review_documents row. That column is a single slot with nowhere to hold
--    a name, which is why the tab rendered every file as the literal "Deal
--    file"; uploads now create a proper row, and these older files need one too
--    or they would disappear from the tab. Cloudinary does not retain the
--    original file name (the public id is randomised at upload and
--    original_filename is not exposed by the Admin API), so the best available
--    name is the deal's own reference plus the format from the URL.

-- ── 1. Attachments named after a URL query/verb ────────────────────────────
update im_review_documents
set document_name = case
      when coalesce(file_url, legacy_file_url) ilike '%drive.google.com%'  then 'Google Drive link'
      when coalesce(file_url, legacy_file_url) ilike '%docs.google.com%'   then 'Google Docs link'
      when coalesce(file_url, legacy_file_url) ilike '%dropbox.com%'       then 'Dropbox link'
      when coalesce(file_url, legacy_file_url) ilike '%onedrive%'          then 'OneDrive link'
      when coalesce(file_url, legacy_file_url) ilike '%1drv.ms%'           then 'OneDrive link'
      when coalesce(file_url, legacy_file_url) ilike '%sharepoint.com%'    then 'SharePoint link'
      else 'Shared link'
    end
where deleted_at is null
  and (
    document_name is null
    or document_name = ''
    or document_name like '%?%'          -- "view?usp=sharing"
    or lower(document_name) in ('view', 'edit', 'preview', 'open', 'download', 'file', 'document')
  );

-- ── 2. Legacy single-slot deal files with no attachment row ────────────────
insert into im_review_documents (deal_id, document_name, file_type, cloudinary_public_id, file_url, uploaded_at)
select
  d.id,
  concat_ws(' ',
    nullif(coalesce(d.acp_ref_no, d.ref_no, ''), ''),
    'deal file'
  ) || coalesce(
    -- extension from the delivery URL (…/<public_id>.pdf), when it has one
    (select '.' || m[1] from regexp_match(d.deal_files_secure_url, '\.([a-zA-Z0-9]{2,5})$') as m),
    ''
  ),
  nullif((select m[1] from regexp_match(d.deal_files_secure_url, '\.([a-zA-Z0-9]{2,5})$') as m), ''),
  d.deal_files_cloudinary_id,
  d.deal_files_secure_url,
  now()
from deals d
where d.deleted_at is null
  and d.deal_files_secure_url is not null
  and d.deal_files_secure_url <> ''
  and not exists (
    select 1
    from im_review_documents i
    where i.deal_id = d.id
      and i.deleted_at is null
      and (
        i.file_url = d.deal_files_secure_url
        or (d.deal_files_cloudinary_id is not null and i.cloudinary_public_id = d.deal_files_cloudinary_id)
      )
  );
