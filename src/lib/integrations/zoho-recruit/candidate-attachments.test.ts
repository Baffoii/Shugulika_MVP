import { describe, expect, it } from "vitest";
import {
  isSupportedResumeContentType,
  parseAttachmentList,
  selectResumeAttachment,
} from "@/lib/integrations/zoho-recruit/candidate-attachments";

describe("parseAttachmentList / selectResumeAttachment", () => {
  it("parses attachment metadata and keeps ids as strings", () => {
    const attachments = parseAttachmentList({
      data: [
        { id: "5123456789012345678", File_Name: "photo.png", Size: 12 },
        { id: "5123456789012345679", File_Name: "Ada_CV.pdf", Size: 99 },
      ],
    });
    expect(attachments).toHaveLength(2);
    expect(typeof attachments[0]!.id).toBe("string");
  });

  it("prefers resume/CV filenames over the first attachment", () => {
    const selected = selectResumeAttachment([
      { id: "1", fileName: "headshot.jpg", size: 1, createdTime: null },
      { id: "2", fileName: "Resume_Final.pdf", size: 2, createdTime: null },
      { id: "3", fileName: "notes.txt", size: 3, createdTime: null },
    ]);
    expect(selected?.id).toBe("2");
  });

  it("rejects unsupported executable-like names", () => {
    const selected = selectResumeAttachment([
      { id: "1", fileName: "payload.exe", size: 1, createdTime: null },
    ]);
    expect(selected).toBeNull();
  });
});

describe("isSupportedResumeContentType", () => {
  it("accepts pdf and common office/image types", () => {
    expect(isSupportedResumeContentType("application/pdf", "cv.pdf")).toBe(true);
    expect(
      isSupportedResumeContentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "cv.docx",
      ),
    ).toBe(true);
  });

  it("accepts Zoho application/x-download when the extension is a resume type", () => {
    expect(
      isSupportedResumeContentType(
        "application/x-downLoad;charset=UTF-8",
        "59afb1cf9554815b2dfff191e1f5bb0c.docx",
      ),
    ).toBe(true);
  });

  it("rejects unsafe types", () => {
    expect(isSupportedResumeContentType("application/x-msdownload", "x.exe")).toBe(false);
  });
});

describe("fileNameFromContentDisposition", () => {
  it("parses RFC 5987 filenames from Zoho downloads", async () => {
    const { fileNameFromContentDisposition } =
      await import("@/lib/integrations/zoho-recruit/candidate-attachments");
    expect(
      fileNameFromContentDisposition(
        "attachment;filename*=UTF-8''59afb1cf9554815b2dfff191e1f5bb0c.docx",
      ),
    ).toBe("59afb1cf9554815b2dfff191e1f5bb0c.docx");
  });
});
