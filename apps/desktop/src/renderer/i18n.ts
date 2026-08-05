import i18next, { type i18n } from "i18next";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const supportedLocales = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export function createI18n(locale: SupportedLocale): i18n {
  const instance = i18next.createInstance();

  void instance.init({
    fallbackLng: "en",
    initImmediate: false,
    interpolation: { escapeValue: false },
    keySeparator: false,
    lng: locale,
    resources: {
      en: { translation: en },
      "zh-CN": { translation: zhCN },
    },
  });

  return instance;
}
