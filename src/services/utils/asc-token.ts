import jwt from "jsonwebtoken";

export const INDIVIDUAL_KEY_ISSUER = "INDIVIDUAL";

export interface ASCTokenParams {
  issuerId: string;
  keyId: string;
  privateKey: string;
}

export function generateASCToken(params: ASCTokenParams): string {
  const now = Math.floor(Date.now() / 1000);
  const claims =
    params.issuerId === INDIVIDUAL_KEY_ISSUER
      ? { sub: "user", iat: now, exp: now + 20 * 60, aud: "appstoreconnect-v1" }
      : { iss: params.issuerId, iat: now, exp: now + 20 * 60, aud: "appstoreconnect-v1" };
  return jwt.sign(claims, params.privateKey, {
    algorithm: "ES256",
    header: { alg: "ES256", kid: params.keyId, typ: "JWT" },
  });
}
