import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { DatabaseService } from "../database/database.service";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface KycFileBody {
  fileName?: string;
  mimeType?: string;
  dataBase64?: string;
}

export interface KycSubmissionBody {
  fullName?: string;
  phone?: string;
  idType?: string;
  idNumber?: string;
  files?: {
    documentFront?: KycFileBody;
    documentBack?: KycFileBody;
    selfie?: KycFileBody;
    paymentProof?: KycFileBody;
  };
}

export interface RejectKycBody {
  reason?: string;
}

interface KycSubmissionRow {
  id: string;
  user_id: string;
  email?: string;
  full_name: string;
  phone: string;
  id_type: string;
  id_number: string;
  document_front_url: string;
  document_back_url: string;
  selfie_url: string;
  payment_proof_url: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class KycService {
  constructor(private readonly db: DatabaseService) {}

  async submit(userId: string, body: KycSubmissionBody) {
    const fullName = this.requiredText(body.fullName, "Legal full name");
    const phone = this.requiredText(body.phone, "Phone number");
    const idType = this.requiredText(body.idType, "ID type");
    const idNumber = this.requiredText(body.idNumber, "ID number");

    const files = body.files ?? {};
    const documentFrontUrl = await this.storeFile(userId, "front", files.documentFront, true);
    const documentBackUrl = await this.storeFile(userId, "back", files.documentBack, true);
    const selfieUrl = await this.storeFile(userId, "selfie", files.selfie, true);
    const paymentProofUrl = await this.storeFile(userId, "payment-proof", files.paymentProof, false);

    const result = await this.db.transaction(async (client) => {
      await client.query("UPDATE users SET kyc_status = 'pending' WHERE id = $1", [userId]);
      return client.query<KycSubmissionRow>(
        `INSERT INTO kyc_submissions
          (user_id, full_name, phone, id_type, id_number, document_front_url, document_back_url, selfie_url, payment_proof_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
         RETURNING id, user_id, full_name, phone, id_type, id_number, document_front_url, document_back_url, selfie_url, payment_proof_url, status, rejection_reason, created_at, updated_at`,
        [userId, fullName, phone, idType, idNumber, documentFrontUrl, documentBackUrl, selfieUrl, paymentProofUrl],
      );
    });

    return { submission: this.toApi(result.rows[0]), user: { id: userId, kycStatus: "pending" } };
  }

  async getLatestForUser(userId: string) {
    const result = await this.db.query<KycSubmissionRow>(
      `SELECT id, user_id, full_name, phone, id_type, id_number, document_front_url, document_back_url, selfie_url, payment_proof_url, status, rejection_reason, created_at, updated_at
       FROM kyc_submissions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
    return { submission: result.rows[0] ? this.toApi(result.rows[0]) : null };
  }

  async listForAdmin() {
    const result = await this.db.query<KycSubmissionRow>(
      `SELECT k.id, k.user_id, u.email, k.full_name, k.phone, k.id_type, k.id_number,
              k.document_front_url, k.document_back_url, k.selfie_url, k.payment_proof_url,
              k.status, k.rejection_reason, k.created_at, k.updated_at
       FROM kyc_submissions k
       JOIN users u ON u.id = k.user_id
       ORDER BY CASE k.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
                k.created_at DESC
       LIMIT 100`,
    );
    return { submissions: result.rows.map((row) => this.toApi(row)) };
  }

  async getForAdmin(submissionId: string) {
    const result = await this.db.query<KycSubmissionRow>(
      `SELECT k.id, k.user_id, u.email, k.full_name, k.phone, k.id_type, k.id_number,
              k.document_front_url, k.document_back_url, k.selfie_url, k.payment_proof_url,
              k.status, k.rejection_reason, k.created_at, k.updated_at
       FROM kyc_submissions k
       JOIN users u ON u.id = k.user_id
       WHERE k.id = $1
       LIMIT 1`,
      [submissionId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("KYC submission not found.");

    return {
      submission: this.toApi(row),
      files: {
        documentFront: await this.fileToDataUrl(row.document_front_url),
        documentBack: await this.fileToDataUrl(row.document_back_url),
        selfie: await this.fileToDataUrl(row.selfie_url),
        paymentProof: row.payment_proof_url ? await this.fileToDataUrl(row.payment_proof_url) : null,
      },
    };
  }

  async approve(submissionId: string, adminId: string) {
    const result = await this.db.transaction(async (client) => {
      const submission = await client.query<KycSubmissionRow>(
        `UPDATE kyc_submissions
         SET status = 'approved',
             reviewed_by = $1,
             reviewed_at = now(),
             rejection_reason = NULL,
             updated_at = now()
         WHERE id = $2
         RETURNING id, user_id, full_name, phone, id_type, id_number, document_front_url, document_back_url, selfie_url, payment_proof_url, status, rejection_reason, created_at, updated_at`,
        [adminId, submissionId],
      );
      if (submission.rowCount === 0) throw new NotFoundException("KYC submission not found.");

      await client.query("UPDATE users SET kyc_status = 'approved' WHERE id = $1", [submission.rows[0].user_id]);
      return submission.rows[0];
    });
    return { submission: this.toApi(result), user: { id: result.user_id, kycStatus: "approved" } };
  }

  async reject(submissionId: string, adminId: string, body: RejectKycBody) {
    const reason = this.requiredText(body.reason, "Rejection reason");
    const result = await this.db.transaction(async (client) => {
      const submission = await client.query<KycSubmissionRow>(
        `UPDATE kyc_submissions
         SET status = 'rejected',
             reviewed_by = $1,
             reviewed_at = now(),
             rejection_reason = $2,
             updated_at = now()
         WHERE id = $3
         RETURNING id, user_id, full_name, phone, id_type, id_number, document_front_url, document_back_url, selfie_url, payment_proof_url, status, rejection_reason, created_at, updated_at`,
        [adminId, reason, submissionId],
      );
      if (submission.rowCount === 0) throw new NotFoundException("KYC submission not found.");

      await client.query("UPDATE users SET kyc_status = 'rejected' WHERE id = $1", [submission.rows[0].user_id]);
      return submission.rows[0];
    });
    return { submission: this.toApi(result), user: { id: result.user_id, kycStatus: "rejected" } };
  }

  private async storeFile(userId: string, label: string, file: KycFileBody | undefined, required: boolean) {
    if (!file?.dataBase64) {
      if (required) throw new BadRequestException(`${label} file is required.`);
      return null;
    }

    const fileName = this.requiredText(file.fileName, `${label} file name`);
    const mimeType = this.requiredText(file.mimeType, `${label} MIME type`);
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(`${label} must be JPEG, PNG, or WEBP.`);
    }

    const bytes = Buffer.from(file.dataBase64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
      throw new BadRequestException(`${label} must be smaller than 8 MB.`);
    }

    const extension = this.extensionFor(fileName, mimeType);
    const relativeDir = `uploads/kyc/${userId}`;
    const absoluteDir = join(process.cwd(), relativeDir);
    const storedName = `${Date.now()}-${label}-${randomUUID()}${extension}`;
    await mkdir(absoluteDir, { recursive: true });
    await writeFile(join(absoluteDir, storedName), bytes);
    return `${relativeDir}/${storedName}`.replace(/\\/g, "/");
  }

  private async fileToDataUrl(relativePath: string) {
    const normalized = relativePath.replace(/\\/g, "/");
    if (!normalized.startsWith("uploads/kyc/")) throw new BadRequestException("Invalid KYC file path.");
    const uploadsRoot = resolve(process.cwd(), "uploads", "kyc");
    const absolutePath = resolve(process.cwd(), normalized);
    if (!absolutePath.startsWith(uploadsRoot)) throw new BadRequestException("Invalid KYC file path.");

    const bytes = await readFile(absolutePath);
    const mimeType = this.mimeFor(absolutePath);
    return { dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`, mimeType, path: normalized };
  }

  private extensionFor(fileName: string, mimeType: string) {
    const extension = extname(fileName).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) return extension;
    if (mimeType === "image/png") return ".png";
    if (mimeType === "image/webp") return ".webp";
    return ".jpg";
  }

  private mimeFor(fileName: string) {
    const extension = extname(fileName).toLowerCase();
    if (extension === ".png") return "image/png";
    if (extension === ".webp") return "image/webp";
    return "image/jpeg";
  }

  private requiredText(value: string | undefined, label: string) {
    const trimmed = value?.trim();
    if (!trimmed) throw new BadRequestException(`${label} is required.`);
    return trimmed;
  }

  private toApi(row: KycSubmissionRow) {
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      phone: row.phone,
      idType: row.id_type,
      idNumber: row.id_number,
      documentFrontUrl: row.document_front_url,
      documentBackUrl: row.document_back_url,
      selfieUrl: row.selfie_url,
      paymentProofUrl: row.payment_proof_url,
      status: row.status,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
