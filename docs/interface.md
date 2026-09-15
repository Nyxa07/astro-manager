# Interface

Le système de style et l'anatomie de l'application. À lire avant d'écrire du HTML, du CSS ou le gabarit d'un composant. Se met à jour quand un écran naît ou qu'une règle change, dans la PR concernée.

La maquette de référence est `docs/maquette.html`, à ouvrir dans un navigateur : branchée sur les vrais jetons (`src/renderer/styles/`), elle montre ce qui n'est pas encore construit et expose le système (couleurs, rôles typographiques, briques). Un écran en sort le jour où il existe dans l'application — l'accueil en est déjà sorti.

## Principes

- **CSS natif, sans préprocesseur ni framework.** Une seule cible, le Chromium d'Electron : nesting, `@layer`, `color-mix()`, container queries. Pas d'Angular Material ; `@angular/cdk` au besoin (virtual scroll, overlay, focus), pas avant.
- **Les jetons sont des custom properties** (`src/renderer/styles/tokens.css`), commutées par `data-theme` sur `<html>` : sombre par défaut — la convention des outils d'astronomie —, clair, nuit (rouge sur noir, préserve l'adaptation à l'obscurité ; `--image-filter` teinte aussi les images). Tout style s'écrit contre un jeton, jamais une couleur littérale. L'accent (or paille) marque l'action et la sélection ; les couleurs sémantiques (`good`, `warn`, `bad`, `info`) marquent un état et ne sont jamais l'accent.
- **Couches** : `styles.css` déclare `@layer base, components` ; `base.css` (socle, rôles typographiques `.label`, `.mono`, `.num`) et `components.css` (briques sans domaine `.btn`, `.chip`, `.field`) y vivent. Les styles de composants Angular sont hors couche, donc prioritaires sans surenchère de spécificité — jamais de `!important`.
- **Polices auto-hébergées** (`@fontsource`, OFL) — la CSP est `default-src 'self'`. IBM Plex Sans pour l'interface, Plex Mono pour chemins, coordonnées et mots-clés ; `.num` (chiffres tabulaires) partout où des nombres s'alignent. Icônes en SVG inline, pas de police d'icônes.

## Anatomie

L'application a deux états : l'**accueil** (aucun espace ouvert : sélecteur, espaces récents) et la **coquille** (un espace ouvert). L'accueil n'est pas dans la coquille, il la précède — c'est `App` qui aiguille sur `workspace.current()`, pas le routeur.

La coquille, telle que la maquette la montre :

| Région              | Rôle                                                                                                               | État     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Barre supérieure    | Identité de l'espace ouvert (nom, racine en `.mono`), recherche globale, action d'import (« Importer une nuit… »). | maquette |
| Rail                | Navigation entre les sections, en groupes ; la section courante porte `aria-current="page"`.                       | maquette |
| Zone centrale       | L'écran de la section courante : titre, statistiques, filtres, contenu (la grille de clichés pour « Clichés »).    | maquette |
| Inspecteur (aside)  | Le détail de la sélection courante : métadonnées, actions. Vide sans sélection.                                    | maquette |
| Barre d'état (pied) | L'état du catalogue (`library.db · schéma v1`), la tâche en cours (balayage, script), les compteurs.               | maquette |

Les sections du rail sont l'ossature de l'application ; elles décideront des routes, à l'intérieur de l'espace :

- **Bibliothèque** — Clichés, Objets, Nuits
- **Traitement** — Scripts Siril, Python
- **Partage** — Publication
- **Réglages**, en bas du rail

Une section marquée « maquette » n'a ni composant ni route ; on renomme quand l'écran existe. Cette table est la seule liste des écrans : un écran nouveau s'y inscrit avant d'être construit.

## Règles d'usage

- **Accent et sémantique.** L'accent (`--accent`, `--accent-fill`, `--accent-ink`) ne sert qu'à l'action principale (`.btn.primary`), à la sélection et au focus. Un état (réussi, en attente, en erreur, informatif) prend une couleur sémantique via `.chip` ou une bordure, jamais l'accent. Un écran a au plus un `.btn.primary` visible.
- **Images sous filtre.** Toute image affichée — vignette, aperçu, `<canvas>` — passe par `filter: var(--image-filter)` pour que le thème nuit la teinte aussi. Le jeton vaut `none` ailleurs, le coût est nul.
- **Rôles typographiques.** `.label` pour une étiquette de rubrique (capitales espacées, `--fs-label`, `--text-3`), `.mono` pour un chemin, une coordonnée, un mot-clé, un identifiant, `.num` dès que des nombres s'alignent en colonne ou en liste (compteurs, tailles, durées). Les tailles viennent de `--fs-*`, jamais d'un `px` littéral ; les espacements de `--space-*`, les rayons de `--radius` et `--radius-lg`.
- **Icônes.** SVG inline, tracé (`fill: none; stroke: currentColor`), 14–16 px, `aria-hidden="true"`. Un bouton qui n'a qu'une icône porte un `aria-label`. Le focus clavier est visible partout (`:focus-visible` dans `base.css`), ne pas le retirer.
- **Mouvement.** Transitions courtes (≤ 150 ms), toujours sous `@media (prefers-reduced-motion: no-preference)`.
- **D'une brique à un composant.** Une classe de `components.css` devient un composant Angular dans `ui/` quand elle porte un comportement — état, clavier, gestion du focus — et pas avant. L'apparence reste dans la couche `components`, le composant n'y ajoute que la logique.
- **Textes.** Interface en français, ponctuation française (espace insécable avant `:`, `;`, `!`, `?`, guillemets « »). Les points de suspension marquent une action qui ouvre un sélecteur ou une boîte (« Importer une nuit… »).

## Briques

Ce que `components.css` fournit ; les variantes se combinent par classes.

| Brique   | Variantes                         | Notes                                                                                |
| -------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `.btn`   | `.primary`, `.quiet`, `:disabled` | `inline-flex`, une icône `> svg` optionnelle avant le texte ; `.quiet` sans bordure. |
| `.chip`  | `.good`, `.warn`, `.bad`, `.info` | Puce d'état avec point coloré ; neutre sans variante. Jamais cliquable.              |
| `.field` | —                                 | Enveloppe un `<input>` (et une icône optionnelle) ; le champ hérite de la bordure.   |
| `.label` | —                                 | Rôle typographique (`base.css`) : étiquette de rubrique.                             |
| `.mono`  | —                                 | Rôle typographique : Plex Mono.                                                      |
| `.num`   | —                                 | Rôle typographique : chiffres tabulaires.                                            |

Une brique nouvelle s'ajoute ici et dans la section « Exposition du système » de la maquette, en même temps.
