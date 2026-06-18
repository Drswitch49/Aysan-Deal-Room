import path from "path";
import { airtableCreate, getTableSchema } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { authenticateAdmin } from "../admin/lenders.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin
    await authenticateAdmin(req);

    const { 
      fileName, 
      fileType, 
      fileData, // base64 string
      documentName, 
      category, 
      status, 
      dealId, 
      ablCritical,
      expectedDate,
      internalNotes
    } = req.body || {};

    if (!documentName || !category || !dealId) {
      return res.status(400).json({ error: "Document Name, Category, and Deal ID are required." });
    }

    if (!fileData) {
      return res.status(400).json({ error: "File data (base64) is required for uploads." });
    }

    // 2. Base64 validation and decoding
    let cleanBase64 = fileData;
    if (fileData.includes(";base64,")) {
      cleanBase64 = fileData.split(";base64,")[1];
    }

    const buffer = Buffer.from(cleanBase64, "base64");

    // 3. Validation Layer: File size checking (25MB maximum limit)
    const MAX_SIZE_BYTES = 25 * 1024 * 1024;
    if (buffer.length > MAX_SIZE_BYTES) {
      return res.status(400).json({ error: "File size exceeds the 25MB maximum limit." });
    }

    // Validation Layer: MIME and Extension checking
    const ALLOWED_MIME_TYPES = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/png",
      "image/jpeg",
      "image/gif",
      "text/plain",
      "text/csv",
      "text/markdown",
      "application/json"
    ];
    const ALLOWED_EXTENSIONS = [
      ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".gif", ".txt", ".csv", ".md", ".json"
    ];

    const fileExt = path.extname(fileName || "").toLowerCase();
    const isMimeAllowed = fileType ? ALLOWED_MIME_TYPES.includes(fileType.toLowerCase()) : false;
    const isExtAllowed = ALLOWED_EXTENSIONS.includes(fileExt);

    if (!isMimeAllowed && !isExtAllowed) {
      return res.status(400).json({ 
        error: `Unsupported file type: ${fileType || "unknown"}. Supported types: PDF, Word, Excel, Images, and Text files.` 
      });
    }

    // 4. Upload to temporary file hosting to generate a public URL
    const formData = new FormData();
    const fileBlob = new Blob([buffer], { type: fileType || "application/octet-stream" });
    formData.append("file", fileBlob, fileName || "document" + fileExt);

    const uploadResponse = await fetch("https://tmpfiles.org/api/v1/upload", {
      method: "POST",
      body: formData
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Temporary file hosting upload failed: ${uploadResponse.statusText} - ${errorText}`);
    }

    const uploadResult = await uploadResponse.json();
    if (uploadResult.status !== "success" || !uploadResult.data?.url) {
      throw new Error(`Temporary file hosting responded with error: ${JSON.stringify(uploadResult)}`);
    }

    // Transform page URL to direct download URL (injecting /dl/)
    const pageUrl = uploadResult.data.url;
    const directDownloadUrl = pageUrl.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/");

    // 5. Formulate Airtable record fields
    // Resolve single select choices dynamically to prevent "Insufficient permission to create new select option"
    let resolvedCategory = category;
    let resolvedStatus = status || "Outstanding";
    let resolvedSource = "Upload Portal";

    const documentTable = TABLES.DOCUMENTS || "Documents";
    const schema = await getTableSchema(documentTable);
    if (schema && schema.fields) {
      const catField = schema.fields.find((f: any) => f.name === "Category");
      if (catField && catField.options?.choices) {
        const choices = catField.options.choices.map((c: any) => c.name);
        const match = choices.find((c: any) => c.toLowerCase() === category.toLowerCase());
        if (match) {
          resolvedCategory = match;
        } else if (choices.length > 0) {
          resolvedCategory = choices[0];
        }
      }

      const statusField = schema.fields.find((f: any) => f.name === "Status");
      if (statusField && statusField.options?.choices) {
        const choices = statusField.options.choices.map((c: any) => c.name);
        const match = choices.find((c: any) => c.toLowerCase() === (status || "Outstanding").toLowerCase());
        if (match) {
          resolvedStatus = match;
        } else if (choices.length > 0) {
          resolvedStatus = choices[0];
        }
      }

      const sourceField = schema.fields.find((f: any) => f.name === "Source");
      if (sourceField && sourceField.options?.choices) {
        const choices = sourceField.options.choices.map((c: any) => c.name);
        const match = choices.find((c: any) => c.toLowerCase() === "upload portal");
        if (match) {
          resolvedSource = match;
        } else if (choices.length > 0) {
          resolvedSource = choices[0];
        }
      }
    }

    const fields: Record<string, any> = {
      "Document_Name": documentName,
      "Category": resolvedCategory,
      "Status": resolvedStatus,
      "Drive_Link": directDownloadUrl,
      "Deal_Ref": [dealId],
      "ABL_Critical": !!ablCritical,
      "Date_Received": new Date().toISOString().split("T")[0],
      "Source": resolvedSource
    };

    if (expectedDate) {
      fields["Expected_Date"] = expectedDate;
    }
    if (internalNotes) {
      fields["internalNotes"] = internalNotes;
    }

    // 6. Create in Airtable
    const createdRecord = await airtableCreate(documentTable, fields);

    // Resolve returned link (could be string or attachment list structure)
    let returnedLink = directDownloadUrl;
    if (createdRecord.fields["Drive_Link"]) {
      const linkVal = createdRecord.fields["Drive_Link"];
      if (Array.isArray(linkVal)) {
        returnedLink = linkVal[0]?.url || directDownloadUrl;
      } else {
        returnedLink = String(linkVal);
      }
    }

    return res.status(200).json({
      success: true,
      result: {
        id: createdRecord.id,
        documentName: createdRecord.fields["Document_Name"] || documentName,
        category: createdRecord.fields["Category"] || category,
        status: createdRecord.fields["Status"] || status,
        driveLink: returnedLink,
        dealRef: dealId,
        ablCritical: !!createdRecord.fields["ABL_Critical"],
        dateReceived: createdRecord.fields["Date_Received"] || fields.Date_Received,
        source: createdRecord.fields["Source"] || fields.Source,
        internalNotes: createdRecord.fields["internalNotes"] || internalNotes || ""
      }
    });

  } catch (err: any) {
    console.error("[Document Upload Error]:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Failed to upload document",
      type: err.type || "INTERNAL_ERROR"
    });
  }
}
