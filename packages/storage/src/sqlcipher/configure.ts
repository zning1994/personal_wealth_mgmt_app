export interface SqlCipherConfigurationTarget {
  pragma(source: string): unknown;
  prepare(source: string): { get(): unknown };
}

export function configureSqlCipher4(
  database: SqlCipherConfigurationTarget,
  key: Uint8Array,
): void {
  database.pragma("cipher='sqlcipher'");
  database.pragma("legacy=4");
  database.pragma(`key="x'${Buffer.from(key).toString("hex")}'"`);
  database.pragma("foreign_keys=ON");
  database.prepare("SELECT count(*) AS count FROM sqlite_master").get();
}
