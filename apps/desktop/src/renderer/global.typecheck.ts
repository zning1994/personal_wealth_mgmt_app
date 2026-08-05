import type { DesktopShellApi } from "../preload/api";

type Equal<Actual, Expected> = (<Value>() => Value extends Actual ? 1 : 2) extends (
  <Value>() => Value extends Expected ? 1 : 2
)
  ? (<Value>() => Value extends Expected ? 1 : 2) extends (<Value>() => Value extends Actual ? 1 : 2)
    ? true
    : false
  : false;

type Expect<Condition extends true> = Condition;

export type RendererPreloadApiReadonlyAssertions = [
  Expect<Equal<Pick<Window, "wealth">, Readonly<Pick<Window, "wealth">>>>,
  Expect<Equal<Window["wealth"], Readonly<DesktopShellApi>>>,
];
