import { useEffect, useState, type JSX } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { AppInfo } from "@pwm/contracts";
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
  return (
    <I18nextProvider i18n={createI18n(locale)}>
      <Shell locale={locale} />
    </I18nextProvider>
  );
}
