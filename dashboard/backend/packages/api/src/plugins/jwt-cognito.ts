import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface JwtVerifier {
  verify(token: string): Promise<{ 'cognito:username': string; sub: string }>;
}

export interface JwtPluginOpts {
  adminUsernames: string[];
  verifier?: JwtVerifier;
  skipJwt?: boolean;
  skipPaths: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: { username: string; sub: string };
  }
}

export async function registerJwtCognito(
  app: FastifyInstance,
  opts: JwtPluginOpts,
): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    const path = req.url.split('?')[0]?.replace(/\/+$/, '') || '/';
    if (opts.skipPaths.includes(path)) return;

    if (opts.skipJwt) {
      req.user = { username: opts.adminUsernames[0] ?? 'atomoh', sub: 'dev' };
      return;
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      void reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const token = header.slice('Bearer '.length);
    if (!opts.verifier) {
      void reply.code(500).send({ error: 'jwt verifier not configured' });
      return;
    }
    try {
      const payload = await opts.verifier.verify(token);
      const username = payload['cognito:username'];
      if (!opts.adminUsernames.includes(username)) {
        void reply.code(403).send({ error: 'forbidden' });
        return;
      }
      req.user = { username, sub: payload.sub };
    } catch {
      void reply.code(401).send({ error: 'invalid token' });
    }
  });
}

// Production verifier wrapping aws-jwt-verify
export async function createCognitoVerifier(args: {
  userPoolId: string;
  clientId: string;
}): Promise<JwtVerifier> {
  const { CognitoJwtVerifier } = await import('aws-jwt-verify');
  const v = CognitoJwtVerifier.create({
    userPoolId: args.userPoolId,
    tokenUse: 'access',
    clientId: args.clientId,
  });
  return {
    async verify(token: string) {
      const out = await v.verify(token);
      return { 'cognito:username': out['username'] as string, sub: out.sub as string };
    },
  };
}
