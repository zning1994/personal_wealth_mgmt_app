export interface UnitOfWork<Context> {
  run<T>(work: (context: Context) => Promise<T>): Promise<T>;
}
