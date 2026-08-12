-- Re-run the attachment rename from 0014 for rows created since.
--
-- 0014 fixed the attachments that had been named after a URL fragment, but only
-- fixed the deal inbox's "paste a URL" box on its Enter key path — the "Add URL"
-- button beside it kept its own url.split("/").pop(), so Drive links added with
-- the button carried on landing in the list called "view?usp=sharing". The
-- button now names links the same way; these are the rows it made in between.
--
-- Written to match on the *shape* of the name rather than a date, so it is
-- idempotent and also catches any equivalent row from another path.

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
  and cloudinary_public_id is null
  and (
    -- a query string where a file name should be ("view?usp=sharing")
    document_name like '%?%'
    -- or a bare viewer verb with no name in it at all
    or lower(document_name) in ('view', 'edit', 'preview', 'open', 'download')
  );
