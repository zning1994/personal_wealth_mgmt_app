import { describe, expect, it } from "vitest";
import { createI18n, supportedLocales } from "./i18n";

describe("renderer locale resources", () => {
  it("keeps stable translation keys across Chinese and English", () => {
    const chinese = createI18n("zh-CN");
    const english = createI18n("en");

    expect(supportedLocales).toEqual(["zh-CN", "en"]);
    expect(chinese.t("app.title")).toBe("个人财富");
    expect(english.t("app.title")).toBe("Personal Wealth");
    expect(chinese.t("privacy.localFirst")).toBe("本地数据默认保持在此设备上");
    expect(english.t("privacy.localFirst")).toBe(
      "Your data stays on this device by default",
    );
  });
});
