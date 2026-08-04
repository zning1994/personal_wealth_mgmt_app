import { DeleteJournalInputSchema, LedgerJournalViewSchema, LinkTransferInputSchema, ListLedgerInputSchema, TransferSuggestionSchema, UnlinkTransferInputSchema } from "@pwm/contracts";
import type { DesktopLedgerService } from "./ledger-service";

export interface LedgerIpcRegistrar {
  handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void;
  removeHandler?(channel: string): void;
}

const channels = ["ledger:list", "ledger:suggestions", "ledger:delete", "ledger:link-transfer", "ledger:unlink-transfer"] as const;

export function registerLedgerIpc(ipc: LedgerIpcRegistrar, service: DesktopLedgerService): () => void {
  ipc.handle("ledger:list", async (_event, payload) => (await service.list(ListLedgerInputSchema.parse(payload ?? {}))).map((item) => LedgerJournalViewSchema.parse(item)));
  ipc.handle("ledger:suggestions", async () => (await service.suggestions()).map((item) => TransferSuggestionSchema.parse(item)));
  ipc.handle("ledger:delete", async (_event, payload) => { await service.delete(DeleteJournalInputSchema.parse(payload)); return undefined; });
  ipc.handle("ledger:link-transfer", async (_event, payload) => { await service.linkTransfer(LinkTransferInputSchema.parse(payload)); return undefined; });
  ipc.handle("ledger:unlink-transfer", async (_event, payload) => { await service.unlinkTransfer(UnlinkTransferInputSchema.parse(payload)); return undefined; });
  return () => { for (const channel of channels) ipc.removeHandler?.(channel); };
}
