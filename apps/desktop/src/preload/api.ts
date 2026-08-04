import type { IpcRenderer } from "electron";
import {
  parseCommandInput,
  parseCommandOutput,
  parseTaskProgress,
  type AppInfo,
  type CancelTaskInput,
  type CommandOutput,
  type StartUtilityTaskInput,
  type TaskProgress,
  type TaskStarted,
  type ImportsApi,
  type CreateImportDraftInput,
  type ImportBatchId,
  type UpdateCandidateInput,
  type SkipCandidateInput,
  type CommitImportInput,
  SelectedSourceSchema,
  ImportDraftViewSchema,
  ImportDraftSummarySchema,
  CommittedBatchViewSchema,
  WorkspaceIdSchema,
  LlmSettingsViewSchema,
  type LlmSettingsApi,
  type SetLlmProviderInput,
  type LlmProviderDto,
  LlmImportAnalysisResultSchema,
  LlmImportAnalyzeInputSchema,
  LlmImportPreviewInputSchema,
  TransmissionApprovalSchema,
  TransmissionPreviewSchema,
  type LlmImportAnalyzeInput,
  type LlmImportPreviewInput,
  type TransmissionPreview,
  AccountDtoSchema,
  type AccountsApi,
  type CreateAccountInput,
  type LedgerApi,
  type ListLedgerInput,
  type DeleteJournalInput,
  type LinkTransferInput,
  type UnlinkTransferInput,
  LedgerJournalViewSchema,
  TransferSuggestionSchema,
  ListLedgerInputSchema,
  DeleteJournalInputSchema,
  LinkTransferInputSchema,
  UnlinkTransferInputSchema,
  type FinanceApi,
  type FinanceOverviewInput,
  type FinanceUpsertBudgetInput,
  type FinanceUpsertGoalInput,
  type FinanceSetBaseCurrencyInput,
  FinanceOverviewInputSchema,
  FinanceOverviewSchema,
  FinanceBudgetProgressSchema,
  FinanceGoalProgressSchema,
  FinanceSettingsSchema,
  FinanceListBudgetsInputSchema,
  FinanceUpsertBudgetInputSchema,
  FinanceUpsertGoalInputSchema,
  FinanceSetBaseCurrencyInputSchema,
  FinanceFxOverrideSchema,
  FinanceSetFxOverrideInputSchema,
  type FinanceSetFxOverrideInput,
  type ActivityApi,
  ActivityOperationSchema,
} from "@pwm/contracts";

export interface DesktopShellApi {
  getAppInfo(): Promise<AppInfo>;
  startTask(input: StartUtilityTaskInput): Promise<TaskStarted>;
  cancelTask(input: CancelTaskInput): Promise<{ cancelled: boolean }>;
  onTaskProgress(listener: (progress: TaskProgress) => void): () => void;
  readonly imports?: ImportsApi;
  readonly llm?: LlmSettingsApi;
  readonly accounts?: AccountsApi;
  readonly ledger?: LedgerApi;
  readonly finance?: FinanceApi;
  readonly activity?: ActivityApi;
}

type InvokableCommand = "app:get-info" | "task:start" | "task:cancel";

export function createDesktopApi(
  ipc: Pick<IpcRenderer, "invoke" | "on" | "removeListener">,
): Readonly<DesktopShellApi> {
  async function invoke<K extends InvokableCommand>(channel: K, input: unknown): Promise<CommandOutput<K>> {
    const safeInput = parseCommandInput(channel, input);
    return parseCommandOutput(channel, await ipc.invoke(channel, safeInput));
  }

  const imports: ImportsApi = {
    getWorkspaceId: async () => WorkspaceIdSchema.parse(await ipc.invoke("imports:get-workspace-id", undefined)),
    selectSource: async () => { const value = await ipc.invoke("imports:select-source", undefined); return value === null ? null : SelectedSourceSchema.parse(value); },
    createDraft: async (input: CreateImportDraftInput) => ImportDraftViewSchema.parse(await ipc.invoke("imports:create-draft", input)),
    getDraft: async (batchId: ImportBatchId) => ImportDraftViewSchema.parse(await ipc.invoke("imports:get-draft", batchId)),
    listDrafts: async () => (await ipc.invoke("imports:list-drafts", undefined) as unknown[]).map((item) => ImportDraftSummarySchema.parse(item)),
    updateCandidate: async (input: UpdateCandidateInput) => ImportDraftViewSchema.parse(await ipc.invoke("imports:update-candidate", input)),
    skipCandidate: async (input: SkipCandidateInput) => ImportDraftViewSchema.parse(await ipc.invoke("imports:skip-candidate", input)),
    cancel: async (batchId: ImportBatchId) => { await ipc.invoke("imports:cancel", batchId); },
    commit: async (input: CommitImportInput) => CommittedBatchViewSchema.parse(await ipc.invoke("imports:commit", input)),
  };
  const llm: LlmSettingsApi = {
    getSettings: async () => LlmSettingsViewSchema.parse(await ipc.invoke("llm:get-settings", undefined)),
    setProvider: async (input: SetLlmProviderInput) => LlmSettingsViewSchema.parse(await ipc.invoke("llm:set-provider", input)),
    deleteProvider: async (provider: LlmProviderDto) => LlmSettingsViewSchema.parse(await ipc.invoke("llm:delete-provider", provider)),
    previewImport: async (input: LlmImportPreviewInput) => TransmissionPreviewSchema.parse(await ipc.invoke("llm:preview-import", LlmImportPreviewInputSchema.parse(input))),
    approveImport: async (preview: TransmissionPreview) => TransmissionApprovalSchema.parse(await ipc.invoke("llm:approve-import", TransmissionPreviewSchema.parse(preview))),
    analyzeImport: async (input: LlmImportAnalyzeInput) => LlmImportAnalysisResultSchema.parse(await ipc.invoke("llm:analyze-import", LlmImportAnalyzeInputSchema.parse(input))),
  };
  const accounts: AccountsApi = {
    list: async () => (await ipc.invoke("accounts:list", undefined) as unknown[]).map((item) => AccountDtoSchema.parse(item)),
    create: async (input: Omit<CreateAccountInput, "workspaceId">) => AccountDtoSchema.parse(await ipc.invoke("accounts:create", input)),
  };
  const ledger: LedgerApi = {
    list: async (input?: ListLedgerInput) => (await ipc.invoke("ledger:list", ListLedgerInputSchema.parse(input ?? {})) as unknown[]).map((item) => LedgerJournalViewSchema.parse(item)),
    suggestions: async () => (await ipc.invoke("ledger:suggestions", undefined) as unknown[]).map((item) => TransferSuggestionSchema.parse(item)),
    delete: async (input: DeleteJournalInput) => { await ipc.invoke("ledger:delete", DeleteJournalInputSchema.parse(input)); },
    linkTransfer: async (input: LinkTransferInput) => { await ipc.invoke("ledger:link-transfer", LinkTransferInputSchema.parse(input)); },
    unlinkTransfer: async (input: UnlinkTransferInput) => { await ipc.invoke("ledger:unlink-transfer", UnlinkTransferInputSchema.parse(input)); },
  };
  const finance: FinanceApi = {
    overview: async (input?: FinanceOverviewInput) => FinanceOverviewSchema.parse(await ipc.invoke("finance:overview", FinanceOverviewInputSchema.parse(input ?? {}))),
    listBudgets: async (input) => (await ipc.invoke("finance:list-budgets", FinanceListBudgetsInputSchema.parse(input)) as unknown[]).map((item) => FinanceBudgetProgressSchema.parse(item)),
    listGoals: async () => (await ipc.invoke("finance:list-goals", undefined) as unknown[]).map((item) => FinanceGoalProgressSchema.parse(item)),
    upsertBudget: async (input: FinanceUpsertBudgetInput) => FinanceBudgetProgressSchema.parse(await ipc.invoke("finance:upsert-budget", FinanceUpsertBudgetInputSchema.parse(input))),
    upsertGoal: async (input: FinanceUpsertGoalInput) => FinanceGoalProgressSchema.parse(await ipc.invoke("finance:upsert-goal", FinanceUpsertGoalInputSchema.parse(input))),
    getSettings: async () => FinanceSettingsSchema.parse(await ipc.invoke("finance:get-settings", undefined)),
    setBaseCurrency: async (input: FinanceSetBaseCurrencyInput) => FinanceSettingsSchema.parse(await ipc.invoke("finance:set-base-currency", FinanceSetBaseCurrencyInputSchema.parse(input))),
    setFxOverride: async (input: FinanceSetFxOverrideInput) => FinanceFxOverrideSchema.parse(await ipc.invoke("finance:set-fx-override", FinanceSetFxOverrideInputSchema.parse(input))),
    deleteFxOverride: async (input) => { const parsed = FinanceSetFxOverrideInputSchema.parse(input); if (!parsed.id) throw new Error("FX_OVERRIDE_ID_REQUIRED"); await ipc.invoke("finance:delete-fx-override", parsed); },
  };
  const activity: ActivityApi = {
    latest: async () => { const value = await ipc.invoke("activity:latest", undefined); return value === null ? null : ActivityOperationSchema.parse(value); },
  };
  return Object.freeze({
    getAppInfo: () => invoke("app:get-info", {}),
    startTask: (input: StartUtilityTaskInput) => invoke("task:start", input),
    cancelTask: (input: CancelTaskInput) => invoke("task:cancel", input),
    onTaskProgress(listener: (progress: TaskProgress) => void) {
      const wrapped = (_event: unknown, value: unknown) => listener(parseTaskProgress(value));
      let subscribed = true;
      ipc.on("task:progress", wrapped);

      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipc.removeListener("task:progress", wrapped);
      };
    },
    imports,
    llm,
    accounts,
    ledger,
    finance,
    activity,
  });
}
