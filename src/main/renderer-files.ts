import * as path from 'node:path';

export type Resolution =
  | { ok: true; file: string }
  | { ok: false; status: number };

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
  return {
    ok: true,
    file: path.extname(target) ? target : path.join(rootDir, 'index.html'),
  };
}
