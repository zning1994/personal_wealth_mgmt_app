import type { ActivityOperation } from "../activity";

export interface ActivityApi {
  latest(): Promise<ActivityOperation | null>;
}
