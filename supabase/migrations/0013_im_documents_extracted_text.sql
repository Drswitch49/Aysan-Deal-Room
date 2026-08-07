-- Cache the text pulled out of each IM/attachment.
--
-- The pre-call brief reads the deal's IM files as source material. Parsing a
-- 100-page PDF on every generation is slow and repeated work, so the extraction
-- is stored on the row and reused until the file is replaced (a replace creates
-- a new row, so the cache can never go stale against its file).
alter table im_review_documents add column if not exists extracted_text text;
alter table im_review_documents add column if not exists extracted_at timestamptz;
alter table im_review_documents add column if not exists extraction_error text;
