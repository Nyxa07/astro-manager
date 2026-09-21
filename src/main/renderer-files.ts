import * as path from 'node:path';

export type RendererMime =
  | 'text/html'
  | 'application/javascript'
  | 'text/css'
  | 'application/json'
  | 'text/plain'
  | 'font/woff2'
  | 'font/woff'
  | 'image/svg+xml'
  | 'image/png'
  | 'image/x-icon'
  | 'application/octet-stream';

// Ce que le build Angular produit : ses trois sorties, ses données, et les
// polices Plex auto-hébergées sous `media/`. Chromium n'exige un type que pour
// html, js et css ; le reste passe en octets s'il n'est pas reconnu.
const MIME_BY_EXTENSIONS = new Map<string, RendererMime>([
  ['.html', 'text/html'],
  ['.js', 'application/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.map', 'application/json'],
  ['.txt', 'text/plain'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

export type Resolution =
  { ok: true; file: string; type: RendererMime } | { ok: false; status: number };

/**
 * Traduit le chemin d'une requête app:// en fichier du build Angular.
 *
 * Fonction pure : aucune dépendance à Electron ni au disque, pour que les cas
 * de traversée de répertoire soient testables sans lancer l'application.
 */
export function resolveRendererFile(pathname: string, rootDir: string): Resolution {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Séquence de pourcentage invalide, par exemple « %zz ».
    return { ok: false, status: 400 };
  }

  // Un octet nul tronque le chemin dans les appels système sous-jacents.
  if (decoded.includes('\0')) {
    return { ok: false, status: 400 };
  }

  const target = path.join(rootDir, decoded);

  // Interdit de sortir du dossier du build.
  // L'URL normalise déjà « /../ », mais pas sa forme encodée « %2e%2e%2f ».
  const relative = path.relative(rootDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, status: 400 };
  }

  // Fallback SPA : une route sans extension renvoie index.html,
  // ce qui fait marcher le rechargement et les liens profonds.
  const file = path.extname(target) ? target : path.join(rootDir, 'index.html');
  // Le type se lit sur le fichier servi, pas sur la demande.
  const extname = path.extname(file);
  const mimeType = MIME_BY_EXTENSIONS.get(extname);
  const type = mimeType ?? 'application/octet-stream';

  return {
    ok: true,
    file,
    type,
  };
}
