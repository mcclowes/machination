/**
 * Verify separately configured operator sessions without enabling player account authentication.
 * @format
 */
import { clerkAuthentication, type AccountAuthentication } from './auth';
import { Failure } from './failure';
import { createPublicKey } from 'node:crypto';

type OperatorConfiguration = {
  [name: string]: string | undefined;
  MACHINATION_OPERATOR_CLERK_ISSUER?: string;
  MACHINATION_OPERATOR_CLERK_JWT_KEY?: string;
  MACHINATION_OPERATOR_ACCOUNTS?: string;
};

export function operatorAuthentication(
  env: OperatorConfiguration,
  origins: string[],
): AccountAuthentication | undefined {
  const configured = [
    env.MACHINATION_OPERATOR_CLERK_ISSUER,
    env.MACHINATION_OPERATOR_CLERK_JWT_KEY,
    env.MACHINATION_OPERATOR_ACCOUNTS,
  ];
  if (configured.every((value) => value === undefined)) return undefined;
  const invalid = () =>
    new Error(
      'Operator review requires MACHINATION_OPERATOR_CLERK_ISSUER, MACHINATION_OPERATOR_CLERK_JWT_KEY (RSA public PEM), MACHINATION_OPERATOR_ACCOUNTS (unique user IDs), and allowed browser origins.',
    );
  if (configured.some((value) => typeof value !== 'string' || !value.trim())) throw invalid();
  const issuer = env.MACHINATION_OPERATOR_CLERK_ISSUER!.trim();
  const jwtKey = env.MACHINATION_OPERATOR_CLERK_JWT_KEY!.replace(/\\n/g, '\n').trim();
  const allowed = env.MACHINATION_OPERATOR_ACCOUNTS!.split(',').map((account) => account.trim());
  if (
    allowed.some((account) => !/^user_[a-zA-Z0-9]+$/.test(account)) ||
    new Set(allowed).size !== allowed.length
  )
    throw invalid();
  let authenticate: AccountAuthentication | undefined;
  try {
    if (
      !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(
        jwtKey,
      ) ||
      createPublicKey(jwtKey).asymmetricKeyType !== 'rsa'
    )
      throw invalid();
    authenticate = clerkAuthentication({ CLERK_ISSUER: issuer, CLERK_JWT_KEY: jwtKey }, origins);
  } catch {
    throw invalid();
  }
  if (!authenticate) throw invalid();
  const verify = authenticate;
  const accounts = new Set(allowed);
  return async (token, origin) => {
    let account;
    try {
      account = await verify(token, origin);
    } catch {
      throw new Failure(
        401,
        'operator.unauthorized.session',
        'Sign in to an authorized operator account.',
      );
    }
    if (!accounts.has(account.accountId))
      throw new Failure(
        403,
        'operator.forbidden.account',
        'This account cannot review player reports.',
      );
    return account;
  };
}
