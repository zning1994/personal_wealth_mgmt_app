import { useEffect, useMemo, useState, type JSX } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { AccountDto, ActivityOperation, AppInfo, CommitImportInput, ImportDraftView, LlmSettingsView, LlmProviderDto, TransmissionPreview, LedgerJournalView, TransferSuggestion, FinanceOverview, FinanceBudgetProgress, FinanceGoalProgress, WorkspaceStatus } from "@pwm/contracts";
import { createI18n, type SupportedLocale } from "./i18n";

export interface AppProps {
  locale: SupportedLocale;
}

type AppStatus =
  | { phase: "checking" }
  | { phase: "ready"; info: AppInfo }
  | { phase: "error" };

function DevicePlate(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AppStatus>({ phase: "checking" });

  useEffect(() => {
    let mounted = true;

    void window.wealth.getAppInfo().then(
      (info) => {
        if (mounted) setStatus({ phase: "ready", info });
      },
      () => {
        if (mounted) setStatus({ phase: "error" });
      },
    );

    return () => {
      mounted = false;
    };
  }, []);

  const statusText =
    status.phase === "ready"
      ? t("status.ready")
      : status.phase === "error"
        ? t("status.error")
        : t("status.checking");

  return (
    <aside className="device-plate" aria-labelledby="device-label">
      <div className="plate-heading">
        <span
          className="status-pip"
          data-phase={status.phase}
          aria-hidden="true"
        />
        <p id="device-label" className="utility-label">
          {t("status.label")}
        </p>
      </div>

      <div
        className="device-status"
        role="status"
        aria-label={t("status.aria")}
      >
        <strong>{statusText}</strong>
        {status.phase === "error" ? <span>{t("status.errorHint")}</span> : null}
      </div>

      <dl className="device-facts">
        <div>
          <dt>{t("status.version")}</dt>
          <dd>
            <output aria-label={t("status.version")}>
              {status.phase === "ready" ? status.info.version : "—"}
            </output>
          </dd>
        </div>
        <div>
          <dt>{t("status.platform")}</dt>
          <dd>
            {status.phase === "ready"
              ? t(`platform.${status.info.platform}`)
              : "—"}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

function Shell({ locale }: AppProps): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ImportDraftView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [llmSettings, setLlmSettings] = useState<LlmSettingsView | null>(null);
  const [llmProvider, setLlmProvider] = useState<LlmProviderDto>("ollama");
  const [llmModel, setLlmModel] = useState("llama3.2");
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBusy, setLlmBusy] = useState(false);
  const [accounts, setAccounts] = useState<readonly AccountDto[]>([]);
  const [aiPreview, setAiPreview] = useState<TransmissionPreview | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestionCount, setAiSuggestionCount] = useState(0);
  const [journals, setJournals] = useState<readonly LedgerJournalView[]>([]);
  const [transferSuggestions, setTransferSuggestions] = useState<readonly TransferSuggestion[]>([]);
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview | null>(null);
  const [budgetProgress, setBudgetProgress] = useState<readonly FinanceBudgetProgress[]>([]);
  const [goalProgress, setGoalProgress] = useState<readonly FinanceGoalProgress[]>([]);
  const [financeMonth, setFinanceMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [budgetLimit, setBudgetLimit] = useState("");
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalAccountId, setGoalAccountId] = useState("");
  const [latestActivity, setLatestActivity] = useState<ActivityOperation | null>(null);
  const [activityHistory, setActivityHistory] = useState<readonly ActivityOperation[]>([]);
  const [workspacePassword, setWorkspacePassword] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [fxFrom, setFxFrom] = useState("");
  const [fxTo, setFxTo] = useState("AED");
  const [fxNumerator, setFxNumerator] = useState("");
  const [fxDenominator, setFxDenominator] = useState("1");
  const [editingJournalId, setEditingJournalId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState("");
  const [editingDescription, setEditingDescription] = useState("");

  useEffect(() => { const llm = window.wealth.llm; if (!llm) return; void llm.getSettings().then(setLlmSettings, () => setLlmSettings({ providers: [] })); }, []);
  useEffect(() => { const accountApi = window.wealth.accounts; if (!accountApi) return; void accountApi.list().then(setAccounts, () => setAccounts([])); }, []);
  useEffect(() => {
    const ledger = window.wealth.ledger;
    if (!ledger) return;
    void Promise.all([ledger.list(), ledger.suggestions()]).then(([entries, suggestions]) => { setJournals(entries); setTransferSuggestions(suggestions); }, () => { setJournals([]); setTransferSuggestions([]); });
  }, []);

  useEffect(() => { void refreshFinance(financeMonth); }, [financeMonth]);
  useEffect(() => { void refreshActivity(); }, []);

  async function refreshActivity(): Promise<void> {
    const activity = window.wealth.activity;
    if (!activity) return;
    try { const [latest, history] = await Promise.all([activity.latest(), activity.list({ limit: 30 })]); setLatestActivity(latest); setActivityHistory(history); } catch { setLatestActivity(null); setActivityHistory([]); }
  }

  async function undoLatest(): Promise<void> {
    const activity = window.wealth.activity;
    const candidate = activityHistory.find((operation) => operation.undoable && operation.undoneAt === null);
    if (!activity || !candidate) return;
    setSecurityBusy(true); setNotice(null);
    try { await activity.undo({ operationId: candidate.id }); await refreshLedger(); await refreshActivity(); setNotice(t("activity.undone")); }
    catch { setNotice(t("activity.undoBlocked")); }
    finally { setSecurityBusy(false); }
  }

  async function toggleAppLock(action: "enable" | "disable"): Promise<void> {
    if (workspacePassword.length < 8) return;
    setSecurityBusy(true); setNotice(null);
    try { if (action === "enable") await window.wealth.workspace.enableAppLock({ password: workspacePassword }); else await window.wealth.workspace.disableAppLock({ password: workspacePassword }); setWorkspacePassword(""); setNotice(t(action === "enable" ? "workspace.lockEnabled" : "workspace.lockDisabled")); }
    catch { setNotice(t("workspace.securityError")); }
    finally { setSecurityBusy(false); }
  }

  async function createBackup(): Promise<void> {
    if (backupPassword.length < 8) return;
    setSecurityBusy(true); setNotice(null);
    try { const result = await window.wealth.workspace.createBackup({ password: backupPassword }); setBackupPassword(""); setNotice(t("workspace.backupCreated", { path: result.path })); }
    catch { setNotice(t("workspace.backupError")); }
    finally { setSecurityBusy(false); }
  }

  async function restoreBackup(): Promise<void> {
    if (backupPassword.length < 8) return;
    setSecurityBusy(true); setNotice(null);
    try { const result = await window.wealth.workspace.restoreBackup({ password: backupPassword }); setBackupPassword(""); setNotice(t("workspace.backupRestored", { count: result.journalCount })); }
    catch { setNotice(t("workspace.backupError")); }
    finally { setSecurityBusy(false); }
  }

  async function refreshFinance(month = financeMonth): Promise<void> {
    const finance = window.wealth.finance;
    if (!finance) return;
    try {
      const [overview, budgets, goals] = await Promise.all([finance.overview({ month, offline: false }), finance.listBudgets({ month }), finance.listGoals()]);
      setFinanceOverview(overview); setBudgetProgress(budgets); setGoalProgress(goals);
    } catch { setNotice(t("finance.error")); }
  }

  async function saveBudget(): Promise<void> {
    const finance = window.wealth.finance;
    const category = accounts.find((account) => account.id === (document.getElementById("budget-category") as HTMLSelectElement | null)?.value && account.kind === "expense");
    if (!finance || !category || !/^\d+$/.test(budgetLimit)) return;
    try { await finance.upsertBudget({ month: financeMonth, categoryAccountId: category.id, currency: category.currency, limitMinor: budgetLimit as never }); setBudgetLimit(""); await refreshFinance(); setNotice(t("finance.budgetSaved")); }
    catch { setNotice(t("finance.error")); }
  }

  async function saveGoal(): Promise<void> {
    const finance = window.wealth.finance;
    if (!finance || !goalAccountId || goalName.trim().length === 0 || !/^\d+$/.test(goalTarget)) return;
    const account = accounts.find((item) => item.id === goalAccountId);
    if (!account) return;
    try { await finance.upsertGoal({ name: goalName, target: { currency: account.currency, minor: goalTarget as never }, targetDate: `${financeMonth}-28`, linkedAccountIds: [account.id] }); setGoalName(""); setGoalTarget(""); await refreshFinance(); setNotice(t("finance.goalSaved")); }
    catch { setNotice(t("finance.error")); }
  }

  async function saveFxOverride(): Promise<void> {
    const finance = window.wealth.finance;
    if (!finance || !fxFrom || !fxTo || fxFrom === fxTo || !/^\d+$/.test(fxNumerator) || !/^\d+$/.test(fxDenominator) || fxNumerator === "0" || fxDenominator === "0") return;
    try { await finance.setFxOverride({ from: fxFrom as never, to: fxTo as never, numerator: fxNumerator as never, denominator: fxDenominator as never, asOf: financeOverview?.asOf ?? new Date().toISOString().slice(0, 10) }); await refreshFinance(); setNotice(t("finance.fxSaved")); }
    catch { setNotice(t("finance.error")); }
  }

  async function refreshLedger(): Promise<void> {
    const ledger = window.wealth.ledger;
    if (!ledger) return;
    try { const [entries, suggestions] = await Promise.all([ledger.list(), ledger.suggestions()]); setJournals(entries); setTransferSuggestions(suggestions); await refreshActivity(); } catch { setNotice(t("ledger.error")); }
  }

  function beginEditJournal(journal: LedgerJournalView): void {
    setEditingJournalId(journal.id);
    setEditingDate(journal.occurredOn);
    setEditingDescription(journal.description);
  }

  function cancelEditJournal(): void {
    setEditingJournalId(null);
    setEditingDate("");
    setEditingDescription("");
  }

  async function saveJournalEdit(journal: LedgerJournalView): Promise<void> {
    const ledger = window.wealth.ledger;
    if (!ledger || !editingDate || !editingDescription.trim()) return;
    try {
      await ledger.update({ id: journal.id, expectedVersion: journal.version, occurredOn: editingDate, description: editingDescription.trim(), postings: journal.postings.map((posting) => ({ id: posting.id as never, accountId: posting.accountId, amountMinor: posting.amountMinor, currency: posting.currency, role: posting.role })) });
      cancelEditJournal();
      await refreshLedger();
    } catch { setNotice(t("ledger.error")); }
  }

  async function classifyJournal(journal: LedgerJournalView, categoryAccountId: string): Promise<void> {
    const ledger = window.wealth.ledger;
    if (!ledger || !categoryAccountId) return;
    try { await ledger.classify({ id: journal.id, expectedVersion: journal.version, categoryAccountId: categoryAccountId as never }); await refreshLedger(); }
    catch { setNotice(t("ledger.error")); }
  }

  async function mergeDuplicate(survivor: LedgerJournalView, duplicate: LedgerJournalView): Promise<void> {
    const ledger = window.wealth.ledger;
    if (!ledger || !window.confirm(t("ledger.mergeConfirm"))) return;
    try { await ledger.merge({ survivorId: survivor.id, duplicateId: duplicate.id, survivorExpectedVersion: survivor.version, duplicateExpectedVersion: duplicate.version }); await refreshLedger(); }
    catch { setNotice(t("ledger.error")); }
  }

  async function saveLlmProvider(): Promise<void> {
    const llm = window.wealth.llm; if (!llm) return; setLlmBusy(true);
    try { const updated = await llm.setProvider({ provider: llmProvider, model: llmModel, ...(llmEndpoint ? { endpoint: llmEndpoint } : {}), enabled: true, ...(llmApiKey ? { apiKey: llmApiKey } : {}) }); setLlmSettings(updated); setLlmApiKey(""); setNotice(t("llm.saved")); }
    catch { setNotice(t("llm.error")); }
    finally { setLlmBusy(false); }
  }

  async function previewAiImport(): Promise<void> {
    const llm = window.wealth.llm; if (!llm || !draft) return; setAiBusy(true); setNotice(null);
    try { setAiPreview(await llm.previewImport({ provider: llmProvider, candidates: draft.candidates })); setAiSuggestionCount(0); }
    catch { setNotice(t("llm.analysisError")); }
    finally { setAiBusy(false); }
  }

  async function sendAiImport(): Promise<void> {
    const llm = window.wealth.llm; if (!llm || !draft || !aiPreview) return; setAiBusy(true); setNotice(null);
    try { const approval = await llm.approveImport(aiPreview); const result = await llm.analyzeImport({ provider: llmProvider, candidates: draft.candidates, preview: aiPreview, approval }); setAiSuggestionCount(result.suggestions.length); setNotice(t("llm.analysisComplete", { count: result.suggestions.length })); }
    catch { setNotice(t("llm.analysisError")); }
    finally { setAiBusy(false); }
  }

  async function importStatement(): Promise<void> {
    const imports = window.wealth.imports;
    if (!imports) { setNotice(t("import.unavailable")); return; }
    setBusy(true); setNotice(null);
    try { const source = await imports.selectSource(); if (!source) return; setDraft(await imports.createDraft({ sourceToken: source.token })); }
    catch { setNotice(t("import.error")); }
    finally { setBusy(false); }
  }

  async function commitDraft(): Promise<void> {
    const imports = window.wealth.imports; if (!imports || !draft || draft.candidates.length === 0) return;
    const cashAccount = accounts.find((account) => account.kind === "asset");
    const categoryAccount = accounts.find((account) => account.kind === "expense" || account.kind === "income");
    if (!cashAccount || !categoryAccount) { setNotice(t("import.accountsRequired")); return; }
    setBusy(true); setNotice(null);
    try {
      const input: CommitImportInput = { workspaceId: await imports.getWorkspaceId(), batchId: draft.batchId, sourceSha256: draft.sourceSha256, idempotencyKey: crypto.randomUUID(), entries: draft.candidates.map((candidate) => ({ rawRecordIds: [candidate.rawRecordId], occurredOn: candidate.transactionDate.value, description: candidate.description.value, postings: [{ accountId: cashAccount.id, amountMinor: candidate.amountMinor.value, currency: candidate.currency.value }, { accountId: categoryAccount.id, amountMinor: (-BigInt(candidate.amountMinor.value)).toString(), currency: candidate.currency.value }] })) };
      await imports.commit(input); setDraft({ ...draft, status: "committed" }); await refreshLedger(); await refreshActivity(); setNotice(t("import.committed"));
    } catch (error: unknown) { setNotice(error instanceof Error && error.message === "IMPORT_SOURCE_ALREADY_COMMITTED" ? t("import.duplicate") : t("import.commitError")); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-shell" lang={locale}>
      <header className="topline">
        <p className="wordmark">{t("app.title")}</p>
        <p
          className="locale-mark"
          aria-label={
            locale === "zh-CN"
              ? "当前语言：简体中文"
              : "Current language: English"
          }
        >
          {locale === "zh-CN" ? "ZH-CN" : "EN"}
        </p>
      </header>

      <main className="ledger-page">
        <section className="opening" aria-labelledby="app-title">
          <p className="eyebrow">{t("app.eyebrow")}</p>
          <h1 id="app-title">{t("app.title")}</h1>
          <p className="thesis">{t("app.thesis")}</p>
          <p className="intro">{t("app.intro")}</p>
          <p className="privacy-line">{t("privacy.localFirst")}</p>
        </section>

        <DevicePlate />

        <section className="preparation" aria-labelledby="prepare-title">
          <p className="utility-label">{t("prepare.label")}</p>
          <h2 id="prepare-title">{t("prepare.title")}</h2>
          <p>{t("prepare.body")}</p>
          <button type="button" className="primary-action" onClick={() => void importStatement()} disabled={busy}>
            {busy ? t("import.working") : t("import.choose")}
          </button>
          {notice ? <p className="inline-notice" role="status">{notice}</p> : null}
        </section>

        {draft ? <section className="import-review" aria-labelledby="review-title">
          <div className="review-heading"><div><p className="utility-label">{t("review.label")}</p><h2 id="review-title">{t("review.title")}</h2></div><span className="review-count">{draft.candidates.length} {t("review.rows")}</span></div>
          {draft.warnings.map((warning) => <p className="review-warning" key={warning}>{warning}</p>)}
          {accounts.length === 0 ? <p className="review-warning">{t("import.accountsRequired")}</p> : null}
          <div className="table-wrap"><table><thead><tr><th>{t("review.date")}</th><th>{t("review.description")}</th><th>{t("review.amount")}</th><th>{t("review.currency")}</th></tr></thead><tbody>{draft.candidates.map((candidate) => <tr key={candidate.rawRecordId}><td>{candidate.transactionDate.value}</td><td>{candidate.description.value}</td><td data-direction={candidate.direction.value}>{candidate.amountMinor.value}</td><td>{candidate.currency.value}</td></tr>)}</tbody></table></div>
          {draft.status === "needs_ocr" ? <p className="review-warning">{t("review.ocrRequired")}</p> : <div className="ai-review">
            {!aiPreview ? <button type="button" className="secondary-action" onClick={() => void previewAiImport()} disabled={aiBusy || !window.wealth.llm}>{aiBusy ? t("llm.analyzing") : t("llm.previewImport")}</button> : <><p className="review-warning">{t("llm.previewNotice", { count: aiPreview.textCharacters })}</p><pre className="transmission-preview">{aiPreview.redactedText}</pre><button type="button" className="secondary-action" onClick={() => void sendAiImport()} disabled={aiBusy}>{aiBusy ? t("llm.analyzing") : t("llm.sendImport")}</button>{aiSuggestionCount > 0 ? <p className="inline-notice">{t("llm.analysisComplete", { count: aiSuggestionCount })}</p> : null}</>}
          </div>}
          {draft.status !== "committed" ? <button type="button" className="primary-action" onClick={() => void commitDraft()} disabled={busy || draft.candidates.length === 0}>{t("review.commit")}</button> : null}
        </section> : null}

        <section className="finance-panel" aria-labelledby="finance-title">
          <div className="review-heading"><div><p className="utility-label">{t("finance.label")}</p><h2 id="finance-title">{t("finance.title")}</h2></div><label className="period-control">{t("finance.month")}<input type="month" value={financeMonth} onChange={(event) => setFinanceMonth(event.target.value)} /></label></div>
          {financeOverview ? <div className="finance-cards"><article className="finance-card"><span>{t("finance.netWorth")}</span><strong>{financeOverview.netWorthMinor === null ? "—" : `${financeOverview.netWorthMinor} ${financeOverview.baseCurrency}`}</strong><small>{financeOverview.fxStatus === "fresh" ? t("finance.fxFresh") : financeOverview.fxStatus === "stale" ? t("finance.fxStale") : t("finance.fxMissing")}{financeOverview.fxAsOf ? ` · ${financeOverview.fxAsOf}` : ""}</small></article><article className="finance-card"><span>{t("finance.cashFlow")}</span><strong>{financeOverview.cashFlowMinor} {financeOverview.baseCurrency}</strong><small>{t("finance.income")}: {financeOverview.incomeMinor} · {t("finance.expense")}: {financeOverview.expenseMinor}</small></article></div> : <p className="empty-state">{t("finance.error")}</p>}
          <div className="finance-columns"><div><h3>{t("finance.budgets")}</h3>{budgetProgress.length === 0 ? <p className="empty-state">{t("finance.noBudgets")}</p> : <ul className="finance-list">{budgetProgress.map((budget) => <li key={budget.id}><span>{budget.categoryAccountId}</span><strong>{budget.spentMinor} / {budget.limitMinor} {budget.currency}</strong></li>)}</ul>}<div className="finance-form"><label htmlFor="budget-category">{t("finance.category")}</label><select id="budget-category" defaultValue=""> <option value="">—</option>{accounts.filter((account) => account.kind === "expense").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><label htmlFor="budget-limit">{t("finance.limit")}</label><input id="budget-limit" inputMode="numeric" value={budgetLimit} onChange={(event) => setBudgetLimit(event.target.value)} /><button type="button" className="secondary-action" onClick={() => void saveBudget()}>{t("finance.saveBudget")}</button></div></div><div><h3>{t("finance.goals")}</h3>{goalProgress.length === 0 ? <p className="empty-state">{t("finance.noGoals")}</p> : <ul className="finance-list">{goalProgress.map((goal) => <li key={goal.id}><span>{goal.name}</span><strong>{goal.currentMinor} / {goal.targetMinor} {goal.targetCurrency} · {goal.completionBasisPoints / 100}%</strong></li>)}</ul>}<div className="finance-form"><label htmlFor="goal-name">{t("finance.goalName")}</label><input id="goal-name" value={goalName} onChange={(event) => setGoalName(event.target.value)} /><label htmlFor="goal-target">{t("finance.goalTarget")}</label><input id="goal-target" inputMode="numeric" value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} /><label htmlFor="goal-account">{t("finance.goalAccount")}</label><select id="goal-account" value={goalAccountId} onChange={(event) => setGoalAccountId(event.target.value)}><option value="">—</option>{accounts.filter((account) => account.kind === "asset").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><button type="button" className="secondary-action" onClick={() => void saveGoal()}>{t("finance.saveGoal")}</button></div></div></div>
          <div className="finance-form fx-form"><h3>{t("finance.fxOverride")}</h3><div className="settings-grid"><label>{t("finance.fxFrom")}<input value={fxFrom} onChange={(event) => setFxFrom(event.target.value.toUpperCase())} placeholder="USD" /></label><label>{t("finance.fxTo")}<input value={fxTo} onChange={(event) => setFxTo(event.target.value.toUpperCase())} /></label><label>{t("finance.fxNumerator")}<input inputMode="numeric" value={fxNumerator} onChange={(event) => setFxNumerator(event.target.value)} /></label><label>{t("finance.fxDenominator")}<input inputMode="numeric" value={fxDenominator} onChange={(event) => setFxDenominator(event.target.value)} /></label></div><button type="button" className="secondary-action" onClick={() => void saveFxOverride()}>{t("finance.saveFx")}</button></div>
          {latestActivity ? <p className="activity-line"><span>{t("activity.latest")}</span> {latestActivity.summary} · {latestActivity.createdAt}</p> : null}
        </section>

        <section className="transactions-panel" aria-labelledby="transactions-title">
          <div className="review-heading"><div><p className="utility-label">{t("ledger.label")}</p><h2 id="transactions-title">{t("ledger.title")}</h2></div><span className="review-count">{journals.length} {t("ledger.rows")}</span></div>
          {transferSuggestions.length > 0 ? <div className="transfer-suggestions" role="status"><p>{t("ledger.suggestions", { count: transferSuggestions.length })}</p>{transferSuggestions.slice(0, 5).map((suggestion) => <button key={`${suggestion.leftJournalId}:${suggestion.rightJournalId}`} type="button" className="secondary-action" onClick={async () => { const ledger = window.wealth.ledger; if (!ledger) return; try { await ledger.linkTransfer({ journalIds: [suggestion.leftJournalId, suggestion.rightJournalId], linkId: crypto.randomUUID() }); await refreshLedger(); } catch { setNotice(t("ledger.error")); } }}>{t("ledger.pair", { score: suggestion.score })}</button>)}</div> : null}
          {journals.length === 0 ? <p className="empty-state">{t("ledger.empty")}</p> : <div className="table-wrap"><table><thead><tr><th>{t("ledger.date")}</th><th>{t("ledger.description")}</th><th>{t("ledger.amount")}</th><th>{t("ledger.actions")}</th></tr></thead><tbody>{journals.map((journal) => { const principal = journal.postings.find((posting) => posting.role === "principal") ?? journal.postings[0]; const counterpart = journal.transferLinkId ? journals.find((item) => item.transferLinkId === journal.transferLinkId && item.id !== journal.id) : undefined; const duplicate = journals.find((item) => item.id !== journal.id && item.deletedAt === null && item.transferLinkId === null && journal.transferLinkId === null && item.occurredOn === journal.occurredOn && item.description.trim().toLowerCase() === journal.description.trim().toLowerCase() && item.postings.length === journal.postings.length && item.postings.every((posting, index) => posting.amountMinor === journal.postings[index]?.amountMinor && posting.currency === journal.postings[index]?.currency)); const category = journal.postings.find((posting) => posting.role === "category"); const editing = editingJournalId === journal.id; return <tr key={journal.id}><td>{editing ? <input type="date" value={editingDate} onChange={(event) => setEditingDate(event.target.value)} aria-label={`${t("ledger.date")} ${journal.description}`} /> : journal.occurredOn}</td><td>{editing ? <input value={editingDescription} onChange={(event) => setEditingDescription(event.target.value)} aria-label={`${t("ledger.description")} ${journal.description}`} /> : <>{journal.description}{journal.transferLinkId ? <span className="transfer-badge">{t("ledger.paired")}</span> : null}</>}</td><td data-direction={principal && BigInt(principal.amountMinor) < 0n ? "debit" : "credit"}>{principal ? `${principal.amountMinor} ${principal.currency}` : "—"}</td><td className="row-actions"><label className="compact-control"><span className="sr-only">{t("ledger.classify")} {journal.description}</span><select value={category?.accountId ?? ""} onChange={(event) => void classifyJournal(journal, event.target.value)}><option value="">{t("ledger.unclassified")}</option>{accounts.filter((account) => account.kind === "expense" || account.kind === "income").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>{editing ? <><button type="button" className="text-action" onClick={() => void saveJournalEdit(journal)}>{t("ledger.save")}</button><button type="button" className="text-action" onClick={cancelEditJournal}>{t("ledger.cancel")}</button></> : <button type="button" className="text-action" onClick={() => beginEditJournal(journal)}>{t("ledger.edit")}</button>}{counterpart ? <button type="button" className="text-action" onClick={async () => { const ledger = window.wealth.ledger; if (!ledger) return; try { await ledger.unlinkTransfer({ journalIds: [journal.id, counterpart.id] }); await refreshLedger(); } catch { setNotice(t("ledger.error")); } }}>{t("ledger.unpair")}</button> : null}{duplicate && journal.id < duplicate.id ? <button type="button" className="text-action" onClick={() => void mergeDuplicate(journal, duplicate)}>{t("ledger.merge")}</button> : null}<button type="button" className="text-action danger" onClick={async () => { const ledger = window.wealth.ledger; if (!ledger) return; try { await ledger.delete({ id: journal.id, expectedVersion: journal.version }); await refreshLedger(); } catch { setNotice(t("ledger.error")); } }}>{t("ledger.delete")}</button></td></tr>; })}</tbody></table></div>}
        </section>

        <section className="settings-panel" aria-labelledby="llm-title">
          <p className="utility-label">{t("llm.label")}</p>
          <h2 id="llm-title">{t("llm.title")}</h2>
          <p>{t("llm.body")}</p>
          <div className="settings-grid">
            <label>{t("llm.provider")}<select value={llmProvider} onChange={(event) => setLlmProvider(event.target.value as LlmProviderDto)}><option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openai-compatible">OpenAI-compatible</option><option value="deepseek-responses">DeepSeek Responses</option></select></label>
            <label>{t("llm.model")}<input value={llmModel} onChange={(event) => setLlmModel(event.target.value)} /></label>
            {llmProvider === "openai-compatible" ? <label>{t("llm.endpoint")}<input value={llmEndpoint} onChange={(event) => setLlmEndpoint(event.target.value)} placeholder="http://127.0.0.1:8000/v1/chat/completions" /></label> : null}
            {llmProvider !== "ollama" ? <label>{t("llm.apiKey")}<input type="password" autoComplete="off" value={llmApiKey} onChange={(event) => setLlmApiKey(event.target.value)} placeholder={t("llm.apiKeyPlaceholder")} /></label> : null}
          </div>
          <button type="button" className="primary-action" onClick={() => void saveLlmProvider()} disabled={llmBusy || !window.wealth.llm}>{llmBusy ? t("llm.saving") : t("llm.save")}</button>
          {llmSettings?.providers.length ? <p className="inline-notice">{t("llm.configured", { count: llmSettings.providers.length })}</p> : null}
        </section>

        <section className="settings-panel workspace-settings" aria-labelledby="workspace-settings-title">
          <p className="utility-label">{t("workspace.label")}</p>
          <h2 id="workspace-settings-title">{t("workspace.settingsTitle")}</h2>
          <div className="settings-grid">
            <label>{t("workspace.password")}<input type="password" autoComplete="new-password" value={workspacePassword} onChange={(event) => setWorkspacePassword(event.target.value)} placeholder={t("workspace.passwordHint")} /></label>
            <div className="row-actions workspace-actions"><button type="button" className="secondary-action" onClick={() => void toggleAppLock("enable")} disabled={securityBusy || workspacePassword.length < 8}>{t("workspace.enableLock")}</button><button type="button" className="secondary-action" onClick={() => void toggleAppLock("disable")} disabled={securityBusy || workspacePassword.length < 8}>{t("workspace.disableLock")}</button></div>
            <label>{t("workspace.backupPassword")}<input type="password" autoComplete="new-password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} placeholder={t("workspace.passwordHint")} /></label>
            <div className="row-actions workspace-actions"><button type="button" className="secondary-action" onClick={() => void createBackup()} disabled={securityBusy || backupPassword.length < 8}>{t("workspace.createBackup")}</button><button type="button" className="secondary-action" onClick={() => void restoreBackup()} disabled={securityBusy || backupPassword.length < 8}>{t("workspace.restoreBackup")}</button></div>
          </div>
          <div className="activity-history"><div className="review-heading"><h3>{t("activity.history")}</h3><button type="button" className="text-action" onClick={() => void undoLatest()} disabled={securityBusy || !activityHistory.some((operation) => operation.undoable && operation.undoneAt === null)}>{t("activity.undoLatest")}</button></div>{activityHistory.length === 0 ? <p className="empty-state">{t("activity.none")}</p> : <ul className="finance-list">{activityHistory.slice(0, 8).map((operation) => <li key={operation.id}><span>{operation.summary}{operation.undoneAt ? ` · ${t("activity.undoneLabel")}` : ""}</span><small>{operation.createdAt}</small></li>)}</ul>}</div>
        </section>
      </main>

      <footer className="footer-line">
        <span>{t("footer.localSpace")}</span>
        <span aria-hidden="true">LOCAL / 01</span>
      </footer>
    </div>
  );
}

export function App({ locale }: AppProps): JSX.Element {
  const i18n = useMemo(() => createI18n(locale), [locale]);

  return (
    <I18nextProvider i18n={i18n}>
      <WorkspaceGate locale={locale} />
    </I18nextProvider>
  );
}

function WorkspaceGate({ locale }: AppProps): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [password, setPassword] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void window.wealth.workspace.status().then(setStatus, () => setError(t("workspace.statusError"))); }, [t]);

  async function unlock(): Promise<void> {
    if (password.length < 8) return;
    setBusy(true); setError(null);
    try { setStatus(await window.wealth.workspace.unlock({ password })); setPassword(""); }
    catch { setError(t("workspace.invalidPassword")); }
    finally { setBusy(false); }
  }

  async function restoreBackup(): Promise<void> {
    if (backupPassword.length < 8) return;
    setBackupBusy(true); setError(null);
    try {
      const result = await window.wealth.workspace.restoreBackup({ password: backupPassword });
      setBackupPassword("");
      setError(t("workspace.backupRestored", { count: result.journalCount }));
    } catch {
      setError(t("workspace.backupError"));
    } finally {
      setBackupBusy(false);
    }
  }

  if (status?.state === "ready") return <Shell locale={locale} />;
  return <div className="workspace-gate" lang={locale}>
    <div className="workspace-gate-card" role="main">
      <p className="eyebrow">{t("workspace.label")}</p>
      <h1>{status?.state === "locked" ? t("workspace.unlockTitle") : status?.state === "recovery" ? t("workspace.recoveryTitle") : t("workspace.loadingTitle")}</h1>
      {status?.state === "locked" ? <>
        <p>{t("workspace.unlockBody")}</p>
        <label>{t("workspace.password")}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void unlock(); }} /></label>
        <button type="button" className="primary-action" onClick={() => void unlock()} disabled={busy || password.length < 8}>{busy ? t("workspace.unlocking") : t("workspace.unlock")}</button>
        {error ? <p className="inline-notice" role="alert">{error}</p> : null}
      </> : status?.state === "recovery" ? <p role="alert">{t("workspace.recoveryBody")}</p> : <p>{error ?? t("workspace.loadingBody")}</p>}
      {status?.state !== undefined && status?.state !== null ? <div className="workspace-recovery-actions">
        <label>{t("workspace.backupPassword")}<input type="password" autoComplete="new-password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} placeholder={t("workspace.passwordHint")} /></label>
        <button type="button" className="secondary-action" onClick={() => void restoreBackup()} disabled={backupBusy || backupPassword.length < 8}>{backupBusy ? t("workspace.restoringBackup") : t("workspace.restoreRecovery")}</button>
        {error && status?.state !== "locked" ? <p className="inline-notice" role="status">{error}</p> : null}
      </div> : null}
    </div>
  </div>;
}
