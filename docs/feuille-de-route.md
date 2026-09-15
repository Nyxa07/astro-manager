# Feuille de route

Où en est le projet et où il va. Importée dans chaque session par `CLAUDE.md` : rester court. Se met à jour dans la PR qui change l'état du projet — un module livré, un canal ajouté, une décision prise, une question tranchée.

L'application vise la gestion d'une bibliothèque de photo astronomique : rangement des clichés en place, scripts Siril et Python, publication. Elle est aussi le terrain de formation de Nyxa à Electron et au typage TypeScript.

## En place

- **Socle** — trois frontières, contrat IPC dérivé d'`IPC`, preload générique, protocole `app://`, verrou de navigation, `database.ts` (migrations sous `PRAGMA user_version`, `application_id` `ASTM`), deux suites de specs.
- **`version`** — `version:get`. Module d'exemple, affiché sur l'accueil.
- **`workspace`** — `workspace:open`, `reopen`, `list`, `current`. Registre JSON des espaces connus dans `userData` ; identité de l'espace (id, nom) dans `<racine>/.astro-manager/library.db`, table `workspace`, schéma v1 ; session courante côté main. Côté renderer : injectable `Workspace`, écran d'accueil (sélecteur, espaces récents). À venir dans ce module : `workspace:forget`.
- **Renderer** — jetons et trois thèmes, socle et briques CSS, pont par injection (`ELECTRON_API`), `App` aiguillé sur `workspace.current()`. La coquille n'existe qu'en maquette.

## Prochaine étape — `image`

Le cœur du logiciel et le premier module qui dépend d'un autre. Décidé :

- Il reçoit la session de `workspace` par sa fabrique, importée depuis `modules/workspace/index.ts`.
- Il découvre les images sous la racine courante et les référence en base par un chemin **relatif** à la racine — aucune copie.
- Il les sert par un schéma **`workspace://<chemin relatif>`** résolu par main sous la racine courante, sur le modèle de `resolveRendererFile` ; jamais un chemin absolu, jamais `file://`.
- Côté renderer : un injectable qui publie la liste, et l'écran « Clichés » de la coquille (grille) — le premier écran à sortir de la maquette.

À trancher au démarrage, dans une séance de questions dédiée : stratégie de balayage (à l'ouverture, à la demande, surveillance) ; formats reconnus (FITS, RAW, TIFF, JPEG/PNG) ; vignettes (générées où, stockées où — `.astro-manager/` ?) ; schéma de la table `image` (migration v2) ; virtualisation de la grille ; nom de l'injectable côté renderer (`Image` masque le global du DOM).

## Ensuite

Ordre indicatif, révisable.

1. **Catalogue** — métadonnées lues des fichiers (en-têtes FITS, EXIF), objets et nuits comme axes de rangement, filtres.
2. **`workspace:forget`** — quand un dossier aura disparu du disque.
3. **Scripts** — Siril et Python : les _ranger_ d'abord ; les _lancer_ est une frontière de sécurité de plus (arguments, chemins, sortie), à concevoir à part.
4. **Publication** — export, cible à définir.
5. **Réglages** — thème persistant, puis le reste quand il existera.

## Décisions prises

- **Aucune copie de fichiers.** La base référence les images en place, en chemins relatifs à la racine : l'espace reste déplaçable et l'utilisateur garde son rangement.
- **Persistance sur deux étages.** `app.getPath('userData')` pour la liste des espaces connus — le seul chemin absolu du système —, `<workspace>/.astro-manager/library.db` pour le catalogue.
- **L'identité d'un espace vit dans sa base**, pas dans le registre : un espace déplacé se réidentifie à la réouverture, le registre n'est qu'un cache de chemins.
- **`node:sqlite`** — disponible sans flag dans Electron 44 / Node 24.20.0, aucun module natif à recompiler. Schéma versionné par `PRAGMA user_version` dès la première migration, signé par `application_id`.
- **Le renderer n'envoie jamais un chemin** ; les fichiers de l'espace lui parviennent par `workspace://`.
- **L'accueil est un état, pas une URL** ; le routeur ne sert qu'à l'intérieur de l'espace.
- **CSS natif, trois thèmes, Plex auto-hébergé** — voir `interface.md`.
- **Pas d'outillage de mémoire externe.** graft essayé et retiré, claude-mem écarté : la mémoire du projet, c'est `docs/` et `git log`.

## Questions ouvertes

- ESLint : `noUnusedLocals` n'est pas réglé, aucun lint au-delà de `tsc` et Prettier.
- Un script npm pour `madge --circular` ?
- Devenir de `version` : module d'exemple, à garder pour un écran « À propos » ou à retirer.
- La conception d'`image` (voir « Prochaine étape »).

## Parcours

Ce que Nyxa a déjà manipulé — l'agent ne le réexplique pas sans demande — et ce qu'il veut rencontrer. L'agent y pioche quand le code s'y prête, sans forcer.

**Acquis** : mapped types et `ChannelsOf` ; annotation sur la variable vs `satisfies` ; variance et validateur partagé (`NoArgChannel`) ; `Handler<C>` comme couture ; `InjectionToken` vs classe injectable ; signaux et `asReadonly()` ; `resource` ; deux étages de specs ; cycles d'injection vs cycles d'import.

**À rencontrer** :

1. Unions discriminées et `switch` exhaustif (`never`) — les sortes de fichiers, les états d'un balayage.
2. Template literal types — typer `workspace://<chemin relatif>` pour qu'un chemin absolu soit refusé à la compilation.
3. `node:sqlite` typé — lignes de base vs types de domaine, migrations, `satisfies` sur un schéma.
4. `protocol.handle` avec `Response` et flux — servir un fichier sans le charger en mémoire, et le tester sans Electron.
5. Générateurs asynchrones (`async function*`) pour un balayage progressif, et comment on teste une itération.
6. Angular : `resource` à `params` dépendant de `workspace.current()`, `linkedSignal`/`computed`, virtual scroll CDK quand la grille dépassera quelques centaines de clichés.
