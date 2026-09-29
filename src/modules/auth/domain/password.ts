import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { PasswordPolicyError } from "@/modules/auth/domain/auth-errors";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 65_536;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024;

const DUMMY_PASSWORD_HASH =
  "scrypt$65536$8$1$A1MBEvbIhEdHjBtX85gh5A$0skXHVsADLbqZxOAWQI1ovF3zgFgeaC-3F0ZkgOTSlgwELjAdafzpOBSsF9fMSQmuW3WMcNEsTKy9TTNJzm09A";

type ScryptParameters = Readonly<{
  cost: number;
  blockSize: number;
  parallelization: number;
}>;

function deriveKey(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

function parsePasswordHash(encodedHash: string):
  | Readonly<{
      parameters: ScryptParameters;
      salt: Buffer;
      expectedKey: Buffer;
    }>
  | undefined {
  const [algorithm, cost, blockSize, parallelization, salt, expectedKey] =
    encodedHash.split("$");

  if (
    algorithm !== "scrypt" ||
    !cost ||
    !blockSize ||
    !parallelization ||
    !salt ||
    !expectedKey
  ) {
    return undefined;
  }

  const parameters = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
  };

  if (
    parameters.cost !== SCRYPT_COST ||
    parameters.blockSize !== SCRYPT_BLOCK_SIZE ||
    parameters.parallelization !== SCRYPT_PARALLELIZATION
  ) {
    return undefined;
  }

  const decodedSalt = Buffer.from(salt, "base64url");
  const decodedExpectedKey = Buffer.from(expectedKey, "base64url");

  if (decodedSalt.length !== 16 || decodedExpectedKey.length !== SCRYPT_KEY_LENGTH) {
    return undefined;
  }

  return {
    parameters,
    salt: decodedSalt,
    expectedKey: decodedExpectedKey,
  };
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new PasswordPolicyError();
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);

  const salt = randomBytes(16);
  const parameters = {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  };
  const derivedKey = await deriveKey(password, salt, parameters);

  return [
    "scrypt",
    parameters.cost,
    parameters.blockSize,
    parameters.parallelization,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parsedHash = parsePasswordHash(encodedHash);

  if (!parsedHash || password.length > 256) {
    return false;
  }

  const actualKey = await deriveKey(
    password,
    parsedHash.salt,
    parsedHash.parameters,
  );

  return timingSafeEqual(actualKey, parsedHash.expectedKey);
}

export async function consumeDummyPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_PASSWORD_HASH);
}
