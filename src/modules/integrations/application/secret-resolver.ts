export interface SecretResolver {
  resolve(referenceKey: string): Promise<string | null>;
}

export class EphemeralSecretResolver implements SecretResolver {
  readonly #values: ReadonlyMap<string, string>;

  constructor(values: Readonly<Record<string, string>> = {}) {
    this.#values = new Map(Object.entries(values));
  }

  async resolve(referenceKey: string): Promise<string | null> {
    return this.#values.get(referenceKey) ?? null;
  }
}

export class EnvironmentSecretResolver implements SecretResolver {
  async resolve(referenceKey: string): Promise<string | null> {
    if (!/^(?:LOCAL_MOCK|META_ADS|GOOGLE_ADS|WHATSAPP)_[A-Z0-9_]{3,120}$/.test(referenceKey)) return null;
    return process.env[referenceKey]?.trim() || null;
  }
}

export const emptySecretResolver = new EphemeralSecretResolver();
export const environmentSecretResolver = new EnvironmentSecretResolver();
