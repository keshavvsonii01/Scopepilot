import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportPdfButton, exportErrorMessage } from "@/components/proposals/export-pdf-button";
import { ApiError, proposalApi } from "./api-client";
import { forwardToApi } from "./api-proxy";

const ID = "65f0a1b2c3d4e5f6a7b8c9d0";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x33, 0x0a, 0x80, 0xff, 0x00]);

afterEach(() => vi.unstubAllGlobals());

describe("proposal PDF export", () => {
  it("proxies the PDF route as binary with its download filename", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="scopepilot-proposal-acme.pdf"' } }));
    const response = await forwardToApi(new Request(`http://web.test/api/v1/proposals/${ID}/pdf`), ["proposals", ID, "pdf"], { baseUrl: "http://api.test", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(`http://api.test/v1/proposals/${ID}/pdf`, expect.objectContaining({ method: "GET" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="scopepilot-proposal-acme.pdf"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("only allows GET on the PDF route and keeps JSON errors as JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ error: "PROPOSAL_NOT_FOUND", message: "No proposal exists in this workspace." }, { status: 404 }));
    const post = await forwardToApi(new Request(`http://web.test/api/v1/proposals/${ID}/pdf`, { method: "POST", body: "{}" }), ["proposals", ID, "pdf"], { baseUrl: "http://api.test", fetchImpl });
    expect(post.status).toBe(405);
    const missing = await forwardToApi(new Request(`http://web.test/api/v1/proposals/${ID}/pdf`), ["proposals", ID, "pdf"], { baseUrl: "http://api.test", fetchImpl });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-disposition")).toBeNull();
    expect(await missing.json()).toMatchObject({ error: "PROPOSAL_NOT_FOUND" });
  });

  it("downloads the blob with the server filename and surfaces API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="scopepilot-proposal-acme.pdf"' } })));
    const { blob, filename } = await proposalApi.pdf(ID);
    expect(filename).toBe("scopepilot-proposal-acme.pdf");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PDF_BYTES);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="../evil.exe"' } })));
    expect((await proposalApi.pdf(ID)).filename).toBe("scopepilot-proposal.pdf");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "PROPOSAL_NOT_FOUND", message: "No proposal exists in this workspace." }, { status: 404 })));
    await expect(proposalApi.pdf(ID)).rejects.toMatchObject({ status: 404, code: "PROPOSAL_NOT_FOUND" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502, headers: { "content-type": "text/html" } })));
    await expect(proposalApi.pdf(ID)).rejects.toMatchObject({ status: 502, code: "UNEXPECTED_RESPONSE" });
  });

  it("describes export failures for the user", () => {
    expect(exportErrorMessage(new ApiError(404, "PROPOSAL_NOT_FOUND", "x"))).toBe("This proposal is no longer available in your workspace.");
    expect(exportErrorMessage(new ApiError(429, "RATE_LIMITED", "x", 120))).toBe("Too many PDF exports. Try again in 2 min.");
    expect(exportErrorMessage(new ApiError(500, "PDF_RENDER_FAILED", "The proposal PDF could not be generated. Try again."))).toBe("The proposal PDF could not be generated. Try again.");
    expect(exportErrorMessage(new TypeError("boom"))).toBe("The PDF could not be downloaded. Try again.");
  });

  it("renders idle, unsaved, exporting, downloaded and error states", () => {
    const render = (props: Parameters<typeof ExportPdfButton>[0]) => renderToStaticMarkup(<ExportPdfButton {...props} />);
    const idle = render({ proposalId: ID, dirty: false });
    expect(idle).toContain("Export PDF");
    expect(idle).not.toContain("disabled");
    const dirty = render({ proposalId: ID, dirty: true });
    expect(dirty).toContain("disabled");
    expect(dirty).toContain("Save your changes to include them in the PDF.");
    const exporting = render({ proposalId: ID, dirty: false, initialState: { kind: "exporting" } });
    expect(exporting).toContain("Preparing PDF…");
    expect(exporting).toContain("disabled");
    expect(render({ proposalId: ID, dirty: false, initialState: { kind: "done", filename: "scopepilot-proposal-acme.pdf" } })).toContain("Downloaded scopepilot-proposal-acme.pdf");
    expect(render({ proposalId: ID, dirty: false, initialState: { kind: "error", message: "Nope." } })).toMatch(/role="alert"[^>]*>PDF not exported: Nope\./);
  });
});
