import { AccountDtoSchema, CreateAccountInputSchema, WorkspaceIdSchema } from "@pwm/contracts";
import type { AccountService } from "./import/in-memory-import-controller";

export interface AccountsIpcRegistrar { handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void; removeHandler?(channel: string): void }

export function registerAccountsIpc(ipc: AccountsIpcRegistrar, service: AccountService, workspaceId: string): () => void {
  WorkspaceIdSchema.parse(workspaceId);
  ipc.handle("accounts:list", async () => (await service.list()).map((value) => AccountDtoSchema.parse(value)));
  ipc.handle("accounts:create", async (_event, payload) => AccountDtoSchema.parse(await service.create(CreateAccountInputSchema.omit({ workspaceId: true }).parse(payload))));
  return () => { ipc.removeHandler?.("accounts:list"); ipc.removeHandler?.("accounts:create"); };
}
