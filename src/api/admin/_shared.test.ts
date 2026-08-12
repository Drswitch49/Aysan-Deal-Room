import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadToCloudinary, formatBytes, MAX_UPLOAD_BYTES } from "./_shared";

/**
 * The size guard has to reject before anything is sent. Over-sized files only
 * ever came back as Cloudinary's "File size too large. Got N. Maximum is
 * 10485760.", after the whole file had been pushed up — and the deal inbox
 * reported that to the user as a bare "File upload failed."
 */
describe("uploadToCloudinary size guard", () => {
  const OVERSIZE = MAX_UPLOAD_BYTES + 1;

  afterEach(() => vi.unstubAllGlobals());

  it("rejects an over-sized file without sending it, naming the file and the limit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadToCloudinary("Project Jonah IM.pdf", "application/pdf", new Blob([new Uint8Array(OVERSIZE)]), "f"),
    ).rejects.toThrow(/"Project Jonah IM\.pdf" is 10\.0 MB — larger than the 10\.0 MB limit/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an over-sized base64 payload too", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadToCloudinary("huge.pdf", "application/pdf", "A".repeat(Math.ceil((OVERSIZE * 4) / 3)), "f"),
    ).rejects.toThrow(/larger than the 10\.0 MB limit/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("weighs a base64 payload by what it decodes to, not its encoded length", async () => {
    // 8 MB of PDF encodes to ~10.7 MB of base64: under the limit as a file,
    // over it as a string. Measuring the string would block a valid upload.
    const fetchMock = vi.fn().mockRejectedValue(new Error("network stubbed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadToCloudinary("in-range.pdf", "application/pdf", "A".repeat(Math.ceil((8 * 1024 * 1024 * 4) / 3)), "f"),
    ).rejects.not.toThrow(/limit on the document store/);
    expect(fetchMock).toHaveBeenCalled();
  });
});

/**
 * A stand-in for XMLHttpRequest that plays out an upload: progress events for
 * the request body, then a 200 with Cloudinary's response shape.
 */
function fakeXhr(events: number[], response: unknown = { public_id: "p", secure_url: "https://x/y.pdf" }, status = 200) {
  const instances: any[] = [];
  class FakeXhr {
    status = 0;
    response: unknown = null;
    responseType = "";
    upload: { onprogress?: (e: any) => void; onload?: () => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    open() {}
    send() {
      for (const loaded of events) this.upload.onprogress?.({ lengthComputable: true, loaded, total: 100 });
      this.upload.onload?.();
      this.status = status;
      this.response = response;
      this.onload?.();
    }
    constructor() {
      instances.push(this);
    }
  }
  return { FakeXhr, instances };
}

/** Sign-upload succeeds so the upload itself is what the test exercises. */
function stubSignUpload() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { apiKey: "k", timestamp: 1, signature: "s", folder: "f", cloudName: "c" } }),
    }),
  );
}

describe("uploadToCloudinary progress reporting", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports the fraction of the body sent, ending at 1 and never going backwards", async () => {
    stubSignUpload();
    const { FakeXhr } = fakeXhr([25, 50, 100]);
    vi.stubGlobal("XMLHttpRequest", FakeXhr);

    const seen: number[] = [];
    await uploadToCloudinary("im.pdf", "application/pdf", new Blob(["x"]), "f", (f) => seen.push(f));

    // The trailing 1 is upload.onload, which covers browsers that skip the
    // final progress event. A bar driven by this must never step back — that is
    // what a stale "hold at 99%" emit here used to do.
    expect(seen).toEqual([0.25, 0.5, 1, 1]);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("ignores progress events whose total the browser does not know", async () => {
    stubSignUpload();
    const instrumented = fakeXhr([]);
    class Indeterminate extends instrumented.FakeXhr {
      send() {
        this.upload.onprogress?.({ lengthComputable: false, loaded: 40, total: 0 });
        super.send();
      }
    }
    vi.stubGlobal("XMLHttpRequest", Indeterminate);

    const seen: number[] = [];
    await uploadToCloudinary("im.pdf", "application/pdf", new Blob(["x"]), "f", (f) => seen.push(f));

    expect(seen).toEqual([1]); // only upload.onload — no NaN, no divide by zero
  });

  it("surfaces Cloudinary's own message when it rejects the upload", async () => {
    stubSignUpload();
    const { FakeXhr } = fakeXhr([100], { error: { message: "File size too large. Got 12582912. Maximum is 10485760." } }, 400);
    vi.stubGlobal("XMLHttpRequest", FakeXhr);

    await expect(uploadToCloudinary("im.pdf", "application/pdf", new Blob(["x"]), "f")).rejects.toThrow(
      /File size too large\. Got 12582912/,
    );
  });
});

describe("formatBytes", () => {
  it("reads in MB above a megabyte and KB below it", () => {
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("10.0 MB");
    expect(formatBytes(14_900_000)).toBe("14.2 MB");
    expect(formatBytes(4_096)).toBe("4 KB");
  });
});
