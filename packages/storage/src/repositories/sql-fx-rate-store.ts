import type { Currency, WorkspaceId } from "@pwm/contracts";
import type { FxRateStore, CachedRate, FxLookup, ManualRateOverride } from "@pwm/fx";
import type { FxOverrideRepository, ManualFxOverrideRecord } from "@pwm/application";
import type { SqlCipherConnection } from "../sqlcipher/driver";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
type Row = Record<string, unknown>;

export function createSqlFxRateStore(
  connection: SqlCipherConnection,
  workspaceId: WorkspaceId,
): FxRateStore & FxOverrideRepository {
  return {
    async findManual(input: FxLookup): Promise<ManualRateOverride | null> {
      if (input.workspaceId !== workspaceId) return null;
      const row = await connection.get<Row>(
        "SELECT id, workspace_id, numerator, denominator, deleted_at, as_of FROM fx_override WHERE workspace_id = ? AND from_currency = ? AND to_currency = ? AND as_of = ? ORDER BY version DESC LIMIT 1",
        [input.workspaceId, input.from, input.to, input.onDate],
      );
      if (row === undefined) return null;
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        rate: { from: input.from, to: input.to, numerator: BigInt(String(row.numerator)), denominator: BigInt(String(row.denominator)), quoteIds: [], asOf: String(row.as_of) },
        deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : String(row.deleted_at),
      };
    },
    async findCached(input: FxLookup): Promise<CachedRate | null> {
      if (input.workspaceId !== workspaceId) return null;
      const row = await connection.get<Row>(
        "SELECT id, provider, field, cny_per_100, published_at_utc, fetched_at, etag, payload_hash, foreign_currency, to_currency, as_of, numerator, denominator FROM fx_quote WHERE workspace_id = ? AND foreign_currency = ? AND to_currency = ? AND as_of = ? ORDER BY fetched_at DESC LIMIT 1",
        [input.workspaceId, input.from, input.to, input.onDate],
      );
      if (row === undefined) return null;
      return {
        provider: "boc",
        field: String(row.field) as CachedRate["field"],
        cnyPer100: String(row.cny_per_100),
        publishedAtUtc: String(row.published_at_utc),
        fetchedAt: String(row.fetched_at),
        etag: row.etag === null || row.etag === undefined ? null : String(row.etag),
        payloadHash: String(row.payload_hash),
        rate: {
          from: String(row.foreign_currency) as Currency,
          to: String(row.to_currency) as Currency,
          numerator: BigInt(String(row.numerator)),
          denominator: BigInt(String(row.denominator)),
          quoteIds: [String(row.id)],
          asOf: String(row.as_of),
        },
      };
    },
    async putCached(rate: CachedRate): Promise<void> {
      const id = rate.rate.quoteIds[0];
      if (id === undefined) throw new Error("FX_QUOTE_ID_REQUIRED");
      await connection.exec(
        `INSERT INTO fx_quote (id, workspace_id, provider, foreign_currency, to_currency, cny_per_100, field, as_of, published_at_utc, fetched_at, etag, payload_hash, numerator, denominator) VALUES (${quote(id)}, ${quote(workspaceId)}, 'boc', ${quote(rate.rate.from)}, ${quote(rate.rate.to)}, ${quote(rate.cnyPer100 ?? "0")}, ${quote(rate.field)}, ${quote(rate.rate.asOf)}, ${quote(rate.publishedAtUtc ?? rate.fetchedAt)}, ${quote(rate.fetchedAt)}, ${rate.etag === null ? "NULL" : quote(rate.etag)}, ${quote(rate.payloadHash)}, ${quote(rate.rate.numerator.toString())}, ${quote(rate.rate.denominator.toString())}) ON CONFLICT(workspace_id, foreign_currency, to_currency, as_of, field) DO UPDATE SET cny_per_100 = excluded.cny_per_100, published_at_utc = excluded.published_at_utc, fetched_at = excluded.fetched_at, etag = excluded.etag, payload_hash = excluded.payload_hash, numerator = excluded.numerator, denominator = excluded.denominator`,
      );
    },
    async saveManualOverride(override: ManualFxOverrideRecord, expectedVersion: number | null): Promise<void> {
      if (override.workspaceId !== workspaceId) throw new Error("WORKSPACE_MISMATCH");
      const existing = await connection.get<Row>(
        "SELECT version FROM fx_override WHERE id = ? AND workspace_id = ?",
        [override.id, override.workspaceId],
      );
      if ((existing === undefined ? null : Number(existing.version)) !== expectedVersion) throw new Error("VERSION_CONFLICT");
      if (existing === undefined) {
        await connection.exec(
          `INSERT INTO fx_override (id, workspace_id, from_currency, to_currency, numerator, denominator, as_of, deleted_at, version) VALUES (${quote(override.id)}, ${quote(override.workspaceId)}, ${quote(override.rate.from)}, ${quote(override.rate.to)}, ${quote(override.rate.numerator.toString())}, ${quote(override.rate.denominator.toString())}, ${quote(override.rate.asOf)}, NULL, ${override.version})`,
        );
      } else {
        await connection.exec(
          `UPDATE fx_override SET from_currency = ${quote(override.rate.from)}, to_currency = ${quote(override.rate.to)}, numerator = ${quote(override.rate.numerator.toString())}, denominator = ${quote(override.rate.denominator.toString())}, as_of = ${quote(override.rate.asOf)}, deleted_at = ${override.deletedAt === null ? "NULL" : quote(override.deletedAt)}, version = ${override.version} WHERE id = ${quote(override.id)} AND workspace_id = ${quote(override.workspaceId)} AND version = ${Number(existing.version)}`,
        );
      }
    },
    async deleteManualOverride(input, expectedVersion): Promise<void> {
      if (input.workspaceId !== workspaceId) throw new Error("WORKSPACE_MISMATCH");
      const result = await connection.get<Row>("SELECT version FROM fx_override WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL", [input.id, input.workspaceId]);
      if (result === undefined || Number(result.version) !== expectedVersion) throw new Error("VERSION_CONFLICT");
      await connection.exec(`UPDATE fx_override SET deleted_at = ${quote(input.deletedAt)}, version = ${expectedVersion + 1} WHERE id = ${quote(input.id)} AND workspace_id = ${quote(input.workspaceId)} AND version = ${expectedVersion}`);
    },
    async findManualOverride(input) {
      if (input.workspaceId !== workspaceId) return null;
      const row = await connection.get<Row>("SELECT id, workspace_id, from_currency, to_currency, numerator, denominator, as_of, deleted_at, version FROM fx_override WHERE workspace_id = ? AND from_currency = ? AND to_currency = ? AND as_of = ? ORDER BY version DESC LIMIT 1", [input.workspaceId, input.from, input.to, input.asOf]);
      if (row === undefined) return null;
      return {
        id: String(row.id), workspaceId: String(row.workspace_id) as WorkspaceId,
        rate: { from: String(row.from_currency) as Currency, to: String(row.to_currency) as Currency, numerator: BigInt(String(row.numerator)), denominator: BigInt(String(row.denominator)), quoteIds: [], asOf: String(row.as_of) },
        deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : String(row.deleted_at), version: Number(row.version),
      };
    },
  };
}
