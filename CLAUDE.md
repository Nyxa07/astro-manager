# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Le projet est francophone : commentaires, noms de tests, messages de commit et échanges en français.

## Rôles

Sauf indication contraire de Nyxa :

- **Nyxa écrit le code applicatif.** Il découvre Electron et la manipulation de types TypeScript ; c'est un objectif du projet autant que l'application elle-même.
- **Claude assiste** : conseil d'architecture, revue, explication des mécanismes de typage. Analyser et expliquer d'abord — n'éditer un fichier source qu'après un impératif explicite (« applique », « fais-le », « corrige »). Une question sur un choix de conception appelle une réponse, pas un patch.
- **Claude écrit les tests** la plupart du temps.
- **Claude écrit une partie de l'UI** : HTML et CSS principalement. Les composants Angular (`.ts`) reviennent à Nyxa quand il a le temps, à Claude sinon.

Quand une revue trouve un défaut, le démontrer plutôt que l'affirmer : casser volontairement le code dans une copie, montrer l'erreur du compilateur, restaurer. C'est la méthode retenue dans ce dépôt (voir « Tester ses tests » plus bas).

## Commandes

```bash
npm run dev              # ng serve + Electron sur http://localhost:4200 (--dev), DevTools ouverts
npm start                # build complet puis Electron sur app:// (mode production)
npm run build            # build:electron (typecheck + esbuild) puis build:renderer (ng build)
npm run typecheck:electron   # tsc -p tsconfig.electron.json — main + preload + shared
npm test                 # test:renderer puis test:main
npm run format           # prettier --write sur tout le dépôt (respecte .gitignore)
npm run format:check     # même chose sans écrire
```

Deux suites, deux runners — une modification côté `shared/` doit être vérifiée par les deux :

```bash
npm run test:main        # vitest, environnement node : src/{main,preload}/**/*.spec.ts
npm run test:renderer    # ng test (vitest + jsdom) : src/renderer/**/*.spec.ts
```

Lancer un seul test :

```bash
npx vitest run --config vitest.main.config.ts renderer-files   # filtre par nom de fichier
npx vitest run --config vitest.main.config.ts -t "rejette"     # filtre par nom de test
npx ng test --watch=false --filter "hors Electron"             # filtre par regex (renderer)
```

`npx tsc -p tsconfig.electron.json --noEmit` est le contrôle le plus rapide après une modification de types : les `.spec.ts` de main/preload sont dans son `include`, donc les assertions `expectTypeOf` y sont vérifiées sans exécuter les tests.

## Les trois frontières

`src/main`, `src/preload`, `src/renderer` ne sont pas des couches : ce sont des **frontières de privilège**, et elles portent des propriétés vérifiables.

| Dossier        | Unité de compilation     | Types ambiants | Produit par                                |
| -------------- | ------------------------ | -------------- | ------------------------------------------ |
| `src/main`     | `tsconfig.electron.json` | `node`         | esbuild → `dist/electron/main/index.js`    |
| `src/preload`  | `tsconfig.electron.json` | `node`         | esbuild → `dist/electron/preload/index.js` |
| `src/renderer` | `tsconfig.app.json`      | _aucun_        | `ng build` → `dist/renderer/`              |
| `src/shared`   | les deux                 | —              | inclus dans chacun                         |

Conséquences à ne pas casser :

- **Le renderer ne voit ni Node ni `src/main`.** `tsconfig.app.json` a `"types": []`. Un import depuis un composant vers `src/main` doit rester visiblement fautif.
- **Le preload est sandboxé** : il ne peut `require` que `electron`. Il doit donc être un bundle autonome — c'est la raison d'être d'esbuild ici, `tsc` ne sert qu'au typage (`noEmit: true`).
- Le découpage est **horizontal par privilège, vertical par nom** : un module s'appelle pareil de chaque côté (`shared/modules/versions.ts`, `main/modules/versions.ts`). Ne pas regrouper par fonctionnalité au premier niveau, cela dissoudrait la frontière.

## Le contrat IPC : une seule source de vérité

Tout descend de `src/shared/ipc.ts`. C'est le cœur du projet et ce qui demande le plus de lecture croisée.

```
IPC (arbre de canaux, as const)
 └─ IpcContract        signatures, clés calculées depuis IPC
     ├─ IpcChannel     = keyof IpcContract
     ├─ ElectronApi    = ApiFrom<typeof IPC>   → ce que le preload expose
     └─ IpcModule<C>   (main/module.ts)        → ce qu'un module implémente
```

- `ChannelsOf<T>` aplatit un sous-arbre d'`IPC` en l'union de ses canaux. C'est la version _type_ du `channelsOf` runtime des specs : le mapped type descend en conservant la forme, le `[keyof T]` final jette la forme et ne garde que les valeurs.
- `ApiFrom<T>` rejoue l'arbre en remplaçant chaque canal par sa signature rendue asynchrone.
- **Le preload n'a aucun code par module** : `build()` dérive l'API entière d'`IPC` par récursion. Ajouter un canal ne demande jamais d'y toucher.

### Ajouter un module

1. `src/shared/modules/<nom>.ts` — les types du domaine et ses gardes (`is…`).
2. `src/shared/ipc.ts` — une branche dans `IPC`, ses signatures dans `IpcContract`.
3. `src/main/modules/<nom>.ts` — `export const <nom>Module = { handlers, validators } satisfies IpcModule<ChannelsOf<typeof IPC.<nom>>>`.
4. `src/main/ipc.ts` — étaler le module dans la composition.

**Invariant central : le contrôle d'exhaustivité vit au point de composition, jamais dans le module.** Un module ne `satisfies` que sa propre tranche (`IpcModule<ChannelsOf<…>>`) ; c'est `src/main/ipc.ts` qui porte le contrôle total :

```ts
const handlers = { ...versionsModule.handlers } satisfies IpcContract;
const validators = { ...versionsModule.validators } satisfies { [C in IpcChannel]: Validator<C> };
```

Sans ces `satisfies`, oublier de composer un module ne produit qu'un `TS7053` opaque dans la boucle de dispatch — une protection accidentelle de `noImplicitAny`, qui disparaît au premier `as`. Avec eux, l'erreur nomme le canal manquant sur la ligne de composition.

Si un module `satisfies` le contrat global, le découpage ne passe pas l'échelle : au deuxième module, chacun est accusé de ne pas implémenter l'autre.

`Validator<C>` et `IpcModule<C>` vivent dans `src/main/module.ts`, pas dans `ipc.ts` — sinon `ipc.ts` et les modules s'importent mutuellement. Le cycle serait aujourd'hui élidé (usage en position de type seulement) mais deviendrait réel dès qu'`ipc.ts` exporterait une valeur.

## Tests

- `src/main/modules/<nom>.spec.ts` — handlers et validateurs, testés sur `<nom>Module` directement.
- `src/main/ipc.spec.ts` — enregistrement, couverture des canaux, rejet des arguments invalides. Ne pas élargir l'API de `ipc.ts` pour la testabilité : passer par `registerIpcHandlers` et le mock d'`ipcMain`.
- Préférer des tests **dérivés d'`IPC`** (parcours de l'arbre, `it.each`) plutôt que codés en dur sur un canal : ajouter un module ne doit pas demander de réécrire les specs.
- Côté renderer, le pont peut être absent (`ng serve`, jsdom) : `window.electronApi` est optionnel et les deux branches sont testées.

### Tester ses tests

Un test nouveau n'est acquis qu'après une mutation qui le fait échouer. Certaines vérifications de ce dépôt sont si structurelles qu'elles cassent la **compilation** plutôt qu'un test — par exemple retirer la garde `if (!window.electronApi)`. C'est un meilleur résultat, pas un test manquant.

## Invariants de sécurité

Établis en même temps que le socle, à ne pas défaire sans raison explicite :

- Le renderer est servi par le protocole `app://` (`registerSchemesAsPrivileged` + `protocol.handle`), pas par `file://`, qui conserve des privilèges étendus tant que le fusible `grantFileProtocolExtraPrivileges` n'est pas désactivé.
- `resolveRendererFile` est **pure** (ni Electron ni disque) pour que la traversée de répertoire soit testable : décodage, octet nul, `path.relative`, repli SPA.
- Verrou de navigation sur `will-navigate`, `will-frame-navigate` et `setWindowOpenHandler` : la fenêtre ne quitte jamais l'origine de l'app ; les liens http(s) partent dans le navigateur système.
- Tout argument venant du renderer est hostile. Chaque canal a un validateur qui rend `null` en cas de refus ; le handler ne s'exécute jamais sur des arguments non validés. `versions:get` indexe `process.versions` — sans sa liste blanche, ce serait une primitive de lecture arbitraire.
- Corollaire pour la suite : **le renderer n'envoie jamais un chemin de fichier**. Il demande l'ouverture d'un sélecteur ; c'est le process principal qui appelle `dialog.showOpenDialog`, et seul le chemin qui en sort est fiable.

## Direction (pas encore implémenté)

L'application vise la gestion d'une bibliothèque de photo astronomique : rangement des clichés, scripts Siril et Python, publication. Décisions déjà prises :

- Premier module à venir : **choisir / ouvrir un espace de travail** (`dialog.showOpenDialog` côté main).
- **Aucune copie de fichiers** : la base référence les images en place, en chemins **relatifs** à la racine de l'espace de travail.
- Persistance sur deux étages : `app.getPath('userData')` pour la liste des espaces connus (le seul chemin absolu du système), et `<workspace>/.astro-manager/library.db` pour le catalogue.
- Base **`node:sqlite`** — vérifié disponible sans flag dans Electron 44 / Node 24.20.0, donc aucun module natif à recompiler. Versionner le schéma avec `PRAGMA user_version` dès la première migration.

## Conventions

- Formatage : `npm run format` avant de conclure une modification. Les réglages vivent dans `.prettierrc` et `.editorconfig` — ne pas les dupliquer ici.
- Importer les types avec `import type` — le preload et les modules en dépendent pour l'élision (pas de `verbatimModuleSyntax`).
- Messages de commit en français, à l'impératif : « Aligne l'identité du projet sur astro-manager ».
