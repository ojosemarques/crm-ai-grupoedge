import { PrismaPg } from "@prisma/adapter-pg";

import { ConfigurationError } from "@/shared/core/errors/application-error";

const POSTGRES_SCHEMA_PATTERN = /^[a-z][a-z0-9_]*$/;

export function getPostgresSchema(databaseUrl: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new ConfigurationError(["DATABASE_URL"]);
  }

  const schema = parsedUrl.searchParams.get("schema") ?? "public";
  if (!POSTGRES_SCHEMA_PATTERN.test(schema)) {
    throw new ConfigurationError(["DATABASE_URL"]);
  }

  return schema;
}

export function getPostgresStartupOptions(databaseUrl: string): string | undefined {
  const schema = getPostgresSchema(databaseUrl);
  return schema === "public" ? undefined : `-c search_path=${schema}`;
}

export function createPostgresAdapter(
  databaseUrl: string,
  poolOptions: Readonly<{
    connectionTimeoutMillis?: number;
    max?: number;
  }> = {},
): PrismaPg {
  const schema = getPostgresSchema(databaseUrl);
  const options = getPostgresStartupOptions(databaseUrl);
  return new PrismaPg(
    {
      ...poolOptions,
      connectionString: databaseUrl,
      ...(options ? { options } : {}),
    },
    { schema },
  );
}
