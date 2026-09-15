# Architecture

Les structures du dépôt et leur raison. À lire avant de toucher `src/main`, `src/preload` ou `src/shared`, d'ajouter un module ou un canal, ou d'écrire une spec. Se met à jour dans la PR qui change une convention — jamais après coup.

Les règles tiennent en huit lignes dans `CLAUDE.md` (« Garde-fous ») ; ici, la mécanique et le pourquoi.

## Les trois frontières

`src/main`, `src/preload`, `src/renderer` ne sont pas des couches : ce sont des **frontières de privilège**, et elles portent des propriétés vérifiables.

| Dossier        | Unité de compilation     | Globaux visibles   | Produit par                                |
| -------------- | ------------------------ | ------------------ | ------------------------------------------ |
| `src/main`     | `tsconfig.electron.json` | Node, pas le DOM   | esbuild → `dist/electron/main/index.js`    |
| `src/preload`  | `tsconfig.electron.json` | Node, pas le DOM   | esbuild → `dist/electron/preload/index.js` |
| `src/renderer` | `tsconfig.app.json`      | le DOM, pas Node   | `ng build` → `dist/renderer/`              |
| `src/shared`   | les deux                 | ni l'un ni l'autre | inclus dans chacun                         |

Conséquences à ne pas casser :

- **Le renderer ne voit ni Node ni `src/main`.** `tsconfig.app.json` a `"types": []`. Un import depuis un composant vers `src/main` doit rester visiblement fautif.
- **Main ne voit pas le navigateur.** `tsconfig.electron.json` a `"lib": ["ES2022"]` — sans lui, le `lib` par défaut charge le DOM et `open`, `close`, `name`, `status` deviennent des globaux muets dans main : un identifiant oublié ne donne plus « nom introuvable » mais une erreur de signature contre `window.open`. `types` règle les paquets `@types/*` (Node), `lib` les déclarations intégrées (DOM) : deux robinets, un par frontière.
- **Le preload est sandboxé** : il ne peut `require` que `electron`. Il doit donc être un bundle autonome — c'est la raison d'être d'esbuild ici, `tsc` ne sert qu'au typage (`noEmit: true`).
- Le découpage est **horizontal par privilège, vertical par nom**. La frontière de privilège est le seul axe horizontal ; en dessous, on regroupe par concept : un module s'appelle pareil de chaque côté (`shared/modules/version.ts`, `main/modules/version.ts`, `renderer/app/modules/version.ts`) et rassemble ses collaborateurs dans son dossier. Ne pas regrouper par fonctionnalité au premier niveau (cela dissoudrait la frontière), ni par sorte de code en dessous — pas de `services/`, `repositories/` : cela disperserait un concept.

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
3. `src/main/modules/<nom>.ts` — ou `src/main/modules/<nom>/index.ts` dès qu'il a des collaborateurs — `export const <nom>Module = { handlers, validators } satisfies IpcModule<ChannelsOf<typeof IPC.<nom>>>`, ou une fabrique `create<Nom>Module(deps)` s'il a des dépendances.
4. `src/main/ipc.ts` — étaler le module dans la composition.
5. `src/renderer/app/modules/<nom>.ts` — ou `modules/<nom>/` dès qu'il a un composant — l'injectable qui lit le pont et publie l'état ; voir « Renderer » plus bas. Les faux ponts des specs (`satisfies ElectronApi`) réclament le nouveau canal : les compléter.
6. `docs/feuille-de-route.md` — le module passe dans « En place », avec ses canaux.

Dans le module, chaque handler et chaque validateur est une **constante annotée par son rôle**, jamais une signature recopiée :

```ts
const create: Handler<typeof IPC.workspace.create> = (input) => { … };
const createValidator: Validator<typeof IPC.workspace.create> = (args) => { … };
```

L'annotation va sur la variable — c'est le seul emplacement qui accepte un type de fonction entier — et donne au corps son type contextuel : `input` reçoit le type de fil, `args` reçoit `unknown[]`, et `[parsed]` est inféré comme tuple. `satisfies IpcModule<…>` vérifie ensuite l'ensemble. `Handler<C>` est vide aujourd'hui (`IpcContract[C]`) : c'est la couture prévue pour donner un jour aux handlers un type d'entrée validé, distinct du type de fil, sans toucher aux modules.

Un validateur **partagé** entre plusieurs canaux se type sur l'union **calculée** des canaux concernés — `NoArgChannel` dans `workspace`, dérivé du contrat par `IpcContract[C] extends () => unknown` — jamais sur l'union de tous les canaux du module. Typé sur l'union entière, `Validator<A | B | C>` est accepté pour chaque canal pris séparément, `reopen` compris : TypeScript compare deux instanciations d'un même alias par la variance mesurée de `C`, la mesure conclut « contravariant » sans revérifier structurellement, et le corps du validateur n'est plus vérifié que contre l'union des tuples. Le `satisfies` de composition ne rattrape rien : les constantes étaient déjà déclarées du bon type.

**Invariant central : le contrôle d'exhaustivité vit au point de composition, jamais dans le module.** Un module ne `satisfies` que sa propre tranche (`IpcModule<ChannelsOf<…>>`) ; c'est `src/main/ipc.ts` qui porte le contrôle total :

```ts
const handlers = { ...versionModule.handlers } satisfies IpcContract;
const validators = { ...versionModule.validators } satisfies { [C in IpcChannel]: Validator<C> };
```

Sans ces `satisfies`, oublier de composer un module ne produit qu'un `TS7053` opaque dans la boucle de dispatch — une protection accidentelle de `noImplicitAny`, qui disparaît au premier `as`. Avec eux, l'erreur nomme le canal manquant sur la ligne de composition.

Si un module `satisfies` le contrat global, le découpage ne passe pas l'échelle : au deuxième module, chacun est accusé de ne pas implémenter l'autre.

`Handler<C>`, `Validator<C>` et `IpcModule<C>` vivent dans `src/main/module.ts`, pas dans `ipc.ts` — sinon `ipc.ts` et les modules s'importent mutuellement. Le cycle serait aujourd'hui élidé (usage en position de type seulement) mais deviendrait réel dès qu'`ipc.ts` exporterait une valeur.

### Arêtes et collaborateurs

`main/modules/` ne contient que des **arêtes** : ce qui reçoit un appel IPC, valide, délègue, répond. Tout ce dont une arête dépend — `dialog`, fichiers, base — lui est **injecté par sa fabrique**, typé au plus étroit (`Pick<typeof dialog, 'showOpenDialog'>` plutôt que `Dialog`). C'est ce qui rend l'arête testable sans Electron ni disque, et c'est la pression de test qui fait tenir la règle : une arête qui ferait une E/S directe ne pourrait plus se tester en isolation.

- Un module est un fichier tant qu'il est seul ; il devient un dossier `modules/<nom>/` quand il a des collaborateurs. `index.ts` est l'arête et **la seule surface importable** ; les autres fichiers sont privés au module. Le chemin d'import `./modules/<nom>` ne change pas.
- Un collaborateur remonte à la racine de `main/` quand un second module en a besoin **et** qu'il n'a plus de propriétaire naturel — c'est le cas de `database.ts`. La racine ne grossit que par promotion. Une dépendance de domaine entre modules (`image` aura besoin de la session de `workspace`) s'importe depuis l'`index.ts` de l'autre module, jamais depuis ses fichiers privés.
- `ipc.ts` est la **racine de composition** : `registerIpcHandlers(deps)` reçoit les dépendances réelles, construites par `index.ts` à `app.whenReady()`, fabrique les modules, compose, enregistre. Les specs lui passent des fausses. Les modules sans dépendance (`version`) restent des constantes.

## Renderer

Les conventions du côté Angular, symétriques de celles de main. Le système de style et l'anatomie de l'interface sont dans `interface.md`.

### Organisation

- `src/renderer/app/modules/<nom>` en miroir de main : un fichier `modules/<nom>.ts` tant que le module n'a qu'un injectable (`version`), un dossier dès qu'il a un composant (`workspace/`). Nommage Angular 20+ sans suffixes (`workspace.ts`, `workspace-picker.ts`). `ui/` accueillera une brique sans domaine quand elle portera un comportement ; tant qu'elle n'a qu'une apparence, c'est une classe de `components.css`.
- **Le pont par injection.** `ELECTRON_API` (`app/electron-api.ts`) est un `InjectionToken<ElectronApi | undefined>` dont la fabrique lit `window.electronApi` : une valeur fournie par l'environnement, pas une classe qu'Angular construit — même critère que côté main, on injecte ce qui n'existe pas dans le process de test. Une classe `implements ElectronApi` devrait recopier le pont que le preload dérive d'`IPC`. `undefined` hors Electron, et chaque consommateur garde ses deux branches.
- **L'injectable d'un module est le seul à parler au pont.** Il publie des signaux et des resources en lecture seule (`asReadonly()`) ; les composants lisent et appellent, ils ne connaissent ni `window` ni `ElectronApi`. Une dépendance entre modules passe par l'injectable de l'autre, jamais par ses composants, et le graphe reste orienté (`image` → `workspace`, jamais l'inverse) ; deux modules qui se réclament l'un l'autre signalent un concept manquant à extraire en dessous. Un cycle d'injection est bruyant (`NG0200`) ; un cycle d'import ES ne l'est pas — `npx madge --circular --extensions ts src/renderer src/main` quand un module en importe un autre pour la première fois.
- **« Espace ouvert ou non » est un état, pas une URL** : `App` aiguille sur `workspace.current()`. Le routeur servira à l'intérieur de l'espace, entre les sections du rail (voir `interface.md`, « Anatomie »).
- **Le `null` d'un canal n'est pas « rien »** : `workspace:open` rend `null` pour un sélecteur annulé et le process principal garde l'espace précédent — le renderer aussi. L'état du renderer se restaure depuis main (`workspace:current`) au démarrage, jamais l'inverse.

### Deux étages de specs

- Une spec de **composant** remplace des injectables — `{ provide: Workspace, useValue: faux }`, le faux typé `satisfies Pick<Workspace, 'current' | 'recent' | …>` pour rester aligné sur la vraie surface ; une resource se simule par une vraie `resource()` créée dans un `useFactory` — et ne connaît pas le pont.
- Une spec d'**injectable** remplace le pont — `{ provide: ELECTRON_API, useValue: faux }` avec un faux `satisfies ElectronApi`, ou `undefined` pour « hors Electron » — et ne connaît pas de composant. Le `satisfies` exige un pont complet : un nouveau canal est signalé dans chaque spec, c'est voulu.
- Simuler un aller-retour IPC par `setTimeout` quand l'ordre des microtâches masquerait un `await` manquant.

## Tests

- `src/main/modules/<nom>.spec.ts` — handlers et validateurs, testés sur `<nom>Module` directement. Les collaborateurs d'un dossier ont chacun leur spec (`registry.spec.ts`, `session.spec.ts`).
- `src/main/ipc.spec.ts` — enregistrement, couverture des canaux, rejet des arguments invalides. Ne pas élargir l'API de `ipc.ts` pour la testabilité : passer par `registerIpcHandlers` et le mock d'`ipcMain`.
- Préférer des tests **dérivés d'`IPC`** (parcours de l'arbre, `it.each`) plutôt que codés en dur sur un canal : ajouter un module ne doit pas demander de réécrire les specs.
- Côté renderer, le pont peut être absent (`ng serve`, jsdom) : `ELECTRON_API` vaut `undefined` et les deux branches sont testées. Deux étages de specs, voir plus haut.
- Un test nouveau n'est acquis qu'après une mutation qui le fait échouer (« Tester ses tests » dans `CLAUDE.md`).

## Invariants de sécurité

Établis en même temps que le socle, à ne pas défaire sans raison explicite :

- Le renderer est servi par le protocole `app://` (`registerSchemesAsPrivileged` + `protocol.handle`), pas par `file://`, qui conserve des privilèges étendus tant que le fusible `grantFileProtocolExtraPrivileges` n'est pas désactivé.
- `resolveRendererFile` est **pure** (ni Electron ni disque) pour que la traversée de répertoire soit testable : décodage, octet nul, `path.relative`, repli SPA.
- Verrou de navigation sur `will-navigate`, `will-frame-navigate` et `setWindowOpenHandler` : la fenêtre ne quitte jamais l'origine de l'app ; les liens http(s) partent dans le navigateur système.
- Tout argument venant du renderer est hostile. Chaque canal a un validateur qui rend `null` en cas de refus ; le handler ne s'exécute jamais sur des arguments non validés. `version:get` indexe `process.versions` — sans sa liste blanche, ce serait une primitive de lecture arbitraire.
- Corollaire pour la suite : **le renderer n'envoie jamais un chemin de fichier**. Il demande l'ouverture d'un sélecteur ; c'est le process principal qui appelle `dialog.showOpenDialog`, et seul le chemin qui en sort est fiable. Les images seront servies par un schéma `workspace://` résolu par main sous la racine courante, sur le même modèle que `resolveRendererFile`.
