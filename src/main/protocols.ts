import { protocol } from 'electron';
import { createServe, type ServeDeps } from './serve';
import type { Modules } from './ipc';
import { resolveRendererFile } from './renderer-files';

export type ProtocolDeps = { fs: ServeDeps['fs']; rendererDir: string };

export const registerProtocolSchemes = () => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: 'workspace',
      privileges: { standard: true, secure: true, stream: true },
    },
  ]);
};

export const registerProtocols = (modules: Modules, deps: ProtocolDeps): void => {
  const { serve } = createServe(deps);
  protocol.handle('app', (request) => {
    const resolved = resolveRendererFile(new URL(request.url).pathname, deps.rendererDir);
    return resolved.ok
      ? serve(resolved.file, resolved.type)
      : new Response(null, { status: resolved.status });
  });

  protocol.handle('workspace', modules.picture.protocol);
};
