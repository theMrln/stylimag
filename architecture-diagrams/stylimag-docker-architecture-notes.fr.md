# Notes d'architecture Docker de Stylimag

## Objectif

Ce document transforme le travail de comparaison d'architecture en référence durable pour Stylimag. Il explique en quoi Stylimag diffère actuellement de Stylo sur le plan Docker, pourquoi ces différences ont probablement émergé, ce qu'elles impliquent en pratique, et ce qui devrait être fait ensuite pour rendre Stylimag plus simple à développer, déployer et maintenir.

Ce document s'appuie sur l'état actuel des dépôts Stylimag et Stylo, en particulier les fichiers compose actifs et historiques, les Dockerfiles de services, la configuration nginx, et les notes de projet déjà présentes dans le dépôt.

## Schémas associés

- [docker-architectures-publication.md](./docker-architectures-publication.md)
- [stylimag-stylo-comparison.md](./stylimag-stylo-comparison.md)
- [stylimag-legacy-full-stack.md](./stylimag-legacy-full-stack.md)

## Résumé exécutif

Stylimag est actuellement dans un état Docker transitoire.

Stylo présente toujours une architecture Docker canonique full-stack avec :

- frontend
- API GraphQL
- MongoDB
- service d'export
- service de conversion pandoc
- hypothèse d'un reverse proxy hôte

Le fichier compose actif de Stylimag présente désormais une architecture plus restreinte, centrée application, avec :

- frontend
- API GraphQL
- MongoDB
- proxy same-origin de nginx frontend vers GraphQL
- construction de l'image frontend dans Docker
- absence de conteneurs export et pandoc dans la pile active

En parallèle, Stylimag contient toujours :

- un fichier compose historique full-stack très proche de Stylo
- des références CI qui supposent encore les anciens noms compose et anciennes cibles de services
- des instructions README qui décrivent encore l'ancienne pile
- un override compose local qui référence un ancien nom de service Mongo et ne correspond plus au compose actif

La conclusion pratique est que Stylimag raconte aujourd'hui deux histoires Docker concurrentes :

- une architecture d'exécution active, simplifiée, adaptée aux besoins applicatifs actuels de la branche
- une architecture de déploiement canonique, héritée de Stylo, toujours reflétée dans certaines docs et workflows

C'est gérable à court terme, mais cela crée de l'ambiguïté pour les développeur·euses, les opérateur·ices de déploiement et les mainteneur·euses.

## Les trois architectures pertinentes

Il faut en réalité garder trois architectures en tête.

### 1. Architecture canonique de Stylo

C'est le modèle orienté production complet, toujours représenté dans Stylo.

Caractéristiques :

- le conteneur frontend sert l'interface
- le conteneur GraphQL fournit l'API et les services de collaboration
- le conteneur MongoDB est vérifié via healthcheck avant le démarrage de GraphQL
- le service d'export orchestre les exports documentaires
- le service pandoc-api effectue les conversions
- les services sont liés à la loopback de l'hôte
- le déploiement suppose un reverse proxy hôte pour l'accès public

Cette architecture est plus large et plus orientée déploiement.

### 2. Architecture active de Stylimag

C'est le chemin Docker actuellement actif dans Stylimag.

Caractéristiques :

- seuls frontend, GraphQL et Mongo sont présents dans le compose actif
- l'image frontend construit ses assets statiques dans Docker via un Dockerfile multi-étapes
- nginx dans le conteneur frontend proxifie les routes GraphQL et les routes liées à l'authentification vers le conteneur API
- Mongo utilise un volume Docker nommé plutôt qu'un bind mount du dépôt
- GraphQL monte `./config` en lecture seule pour la configuration d'instance (par exemple OJS)
- les services sont publiés directement plutôt que limités à la loopback

Cette architecture est plus étroite et davantage centrée application.

### 3. Architecture historique de Stylimag

Stylimag conserve aussi un fichier compose historique presque identique à la pile canonique Stylo.

Caractéristiques :

- les noms de services correspondent à la convention Stylo
- export et pandoc restent inclus
- Mongo utilise un bind mount
- le binding loopback hôte est utilisé
- les références d'images et hypothèses CI sont plus proches de Stylo

Cette architecture semble conservée comme instantané de compatibilité ou référence de repli.

## Pourquoi Stylimag a probablement divergé

La divergence est techniquement cohérente.

### Simplicité same-origin et cookies

Le nginx frontend de Stylimag proxifie explicitement GraphQL et les routes liées à l'authentification vers le backend. Cela réduit la nécessité de gérer les cas limites CORS et cookies entre origines frontend et backend séparées.

Ce changement n'est pas arbitraire. Il correspond aux notes du projet sur les apprentissages autour des cookies, du CORS et du proxying. L'architecture active simplifiée semble privilégier une origine navigateur unique et un routage interne conteneur-vers-conteneur.

### Focalisation sur la branche

Le travail Imaginations a ajouté l'intégration OJS, des traitements de métadonnées supplémentaires, et des changements frontend/application. La pile active de Stylimag paraît optimisée pour ce travail applicatif, plutôt que pour maintenir toute la chaîne éditoriale de déploiement Stylo.

Autrement dit, le compose actif ressemble à un environnement d'exécution orienté branche, pas à une déclaration de plateforme finale.

### Meilleure autosuffisance conteneur du frontend

Le Dockerfile frontend de Stylimag construit maintenant l'application dans l'image. Cela rend l'image frontend plus autonome et moins dépendante d'un build produit côté hôte. Stylo attend encore des artefacts frontend montés dans nginx depuis l'hôte.

C'est, en général, une modernisation pertinente.

### Séparation des préoccupations d'export

L'absence de `export-stylo` et `pandoc-api` dans le compose actif de Stylimag suggère l'une des trois intentions suivantes :

- l'export est temporairement hors périmètre pour le travail de branche en cours
- l'export est attendu comme service externe ou séparé
- le support export n'est pas encore terminé dans la nouvelle pile active

À ce stade, l'état du dépôt ne rend pas cette décision explicite.

## Différences détaillées

### Inventaire des services

La pile canonique Stylo inclut cinq services.

- frontend
- GraphQL
- MongoDB
- export
- pandoc-api

La pile active Stylimag inclut trois services.

- frontend
- GraphQL
- MongoDB

Impact :

- la pile active Stylimag ne remplace pas complètement le modèle de déploiement Stylo
- tout workflow dépendant de l'export est absent de la pile active ou dépend d'une infrastructure séparée

### Stratégie d'image frontend

Le conteneur frontend Stylo est une image nginx de runtime qui attend des artefacts build montés depuis l'hôte.

Le conteneur frontend Stylimag réalise un build multi-étapes et embarque le frontend construit dans l'image.

Impact :

- le conteneur frontend Stylimag est plus facile à reproduire en isolation
- CI et déploiement sont plus simples si Docker devient la source de vérité
- la gestion d'artefacts côté hôte devient moins importante

### Proxy et comportement côté navigateur

La configuration nginx frontend de Stylo est minimale et sert surtout des fichiers statiques.

La configuration nginx frontend de Stylimag proxifie :

- `/graphql`
- les routes de login et d'authentification
- les routes websocket
- les routes d'événements

Impact :

- Stylimag réduit la complexité cross-origin
- frontend et API sont présentés comme une seule origine pour le navigateur
- les flux cookies et sessions devraient être plus prévisibles

### Modèle de persistance Mongo

Stylo utilise un bind mount du dépôt pour les données Mongo.

Stylimag utilise un volume Docker nommé.

Impact :

- les volumes nommés sont plus propres pour le cycle de vie des conteneurs
- les bind mounts sont plus faciles à inspecter manuellement depuis le répertoire du dépôt
- l'équipe devrait choisir selon ses besoins de sauvegarde, portabilité et debug local

### Coordination du démarrage

Stylo attend le healthcheck MongoDB avant de démarrer GraphQL.

Le compose actif Stylimag utilise seulement un ordre de dépendances simple.

Impact :

- le démarrage Stylimag est plus fragile si GraphQL s'initialise avant que Mongo ne soit prêt
- healthchecks et conditions de service devraient probablement revenir, sauf si la tolérance au démarrage est volontaire

### Exposition réseau

Stylo bind les ports de services sur `127.0.0.1`.

Stylimag publie les ports plus largement.

Impact :

- Stylimag est plus permissif par défaut sur l'exposition hôte
- cela peut être pratique en développement local
- c'est un défaut plus faible pour la production ou les hôtes partagés

### Commande runtime GraphQL

Le conteneur GraphQL de Stylo exécute le script `prod`.

Le conteneur GraphQL de Stylimag exécute le script `start`.

Impact :

- cela peut être intentionnel si la pile active est considérée comme un runtime simplifié
- ou cela peut indiquer une dérive vis-à-vis des attentes de production
- si Stylimag doit devenir une vraie cible de déploiement, ce point doit être tranché explicitement

## Incohérences actuelles dans Stylimag

Ce sont les points d'amélioration les plus importants, car ils créent de la confusion aujourd'hui.

### Dérive de la documentation

Les instructions Docker du README Stylimag décrivent encore les anciens noms de services full-stack et anciennes commandes de démarrage, plutôt que le compose actif.

Résultat :

- une nouvelle personne contributrice peut démarrer les mauvais services
- le README ne peut plus être considéré comme guide opérationnel fiable

### Dérive CI et workflows

Le workflow Docker GitHub de Stylimag référence encore `docker-compose.yaml` et des cibles de build anciennes alignées sur les conventions de nommage Stylo, alors que le compose actif est `docker-compose.yml` et ne décrit plus le même inventaire de services.

Résultat :

- la CI n'est pas clairement alignée avec l'architecture runtime active
- l'intention de publication d'images n'est pas claire

### Dérive des overrides locaux

Le `docker-compose.local.yaml` de Stylimag cible encore `mongodb-stylo`, qui n'existe plus dans le compose actif où le service est nommé `mongo`.

Résultat :

- les overrides locaux sont structurellement obsolètes
- toute personne qui attend un comportement local via override peut obtenir des résultats cassés ou trompeurs

### Ambiguïté actif versus historique

Stylimag possède maintenant à la fois un compose actif et un compose historique, mais aucun document d'autorité n'explique :

- lequel est canonique
- lequel est déprécié
- lequel utiliser en développement local
- lequel utiliser en déploiement
- si l'export est volontairement absent ou simplement différé

Résultat :

- les mainteneur·euses doivent inférer l'intention architecturale à partir du contenu des fichiers

## Évaluation de la direction active de Stylimag

La direction active de Stylimag n'est pas mauvaise. Sur plusieurs aspects, elle est meilleure que le modèle hérité.

### Ce qui est mieux

- le proxy same-origin est plus simple opérationnellement pour l'auth navigateur et les sessions
- la construction frontend dans l'image est plus propre et plus reproductible
- les volumes nommés réduisent la pollution du dépôt pour la persistance base de données
- le montage de config supporte proprement les intégrations spécifiques d'instance comme OJS

### Ce qui est plus faible ou incomplet

- export et pandoc ne sont plus représentés dans la pile active
- l'orchestration de démarrage est moins robuste sans healthchecks
- docs et CI ne correspondent pas à l'architecture active
- une exposition plus large des ports n'est pas un bon défaut si la pile est réutilisée hors développement local

Le vrai problème n'est pas que Stylimag ait changé d'architecture. Le vrai problème est que le dépôt n'a pas encore complètement assumé les conséquences de ce changement.

## Recommandations pour la suite

La recommandation la plus importante est de choisir et documenter un modèle d'exploitation cible.

### Recommandation 1 : déclarer explicitement une architecture cible

Stylimag devrait définir l'un des chemins suivants.

Option A : Stylimag devient une pile simplifiée centrée application.

- le compose actif reste frontend + GraphQL + Mongo
- l'export est externe ou hors périmètre
- le proxy frontend same-origin reste central
- la documentation de déploiement est réécrite autour de ce modèle

Option B : Stylimag reste une plateforme complète dérivée de Stylo.

- export et pandoc reviennent dans le compose actif
- les chemins historique et actif sont fusionnés
- la pile redevient complète pour le déploiement

Option C : Stylimag supporte intentionnellement les deux modes.

- mode app-only pour développement local et travail fonctionnel
- mode full-stack pour déploiement et workflows d'export
- usage de profils compose ou de plusieurs points d'entrée compose explicitement documentés

Sans choix explicite, la dérive architecturale continuera.

### Recommandation 2 : remplacer l'ambiguïté par des profils compose ou points d'entrée nommés

Si Stylimag a besoin d'un mode léger et d'un mode full-stack, il ne faut pas dépendre de `docker-compose.old.yaml` comme repli historique implicite.

Meilleures options :

- un seul compose avec profils `app`, `export`, et `full`
- ou deux fichiers clairement nommés comme `compose.app.yml` et `compose.full.yml`

Cela rendrait l'intention explicite et supprimerait le statut ambigu du fichier `docker-compose.old.yaml`.

### Recommandation 3 : aligner la documentation sur la réalité

Au minimum, mettre à jour :

- instructions Docker du README
- guide LOCAL-DEV
- notes de déploiement
- page index des schémas si elle est ajoutée plus tard

Le dépôt doit répondre sans ambiguïté :

- comment lancer Stylimag localement avec Docker
- si l'export est actuellement supporté en Docker
- si la pile active est destinée au déploiement ou uniquement au développement

### Recommandation 4 : aligner la CI sur le chemin choisi

Si Stylimag doit publier des images ou valider des builds Docker, le workflow doit pointer vers les vrais fichiers compose et les vraies cibles de services en usage.

Actions :

- mettre à jour les références de noms de fichiers compose
- mettre à jour les noms de services et cibles
- supprimer les hypothèses obsolètes si l'export n'est plus construit ici
- ou réintroduire explicitement les services manquants s'ils font toujours partie du produit

### Recommandation 5 : restaurer la robustesse de démarrage

Si la pile active reste en usage, réintroduire :

- healthcheck Mongo
- dépendance de démarrage GraphQL basée sur l'état de santé

C'est une amélioration peu coûteuse avec un gain clair de fiabilité.

### Recommandation 6 : décider d'une politique d'exposition des ports

Pour le confort de développement local, une publication large peut être acceptable.

Pour tout contexte de type déploiement, préférer :

- binding loopback
- ou absence de publication directe pour les services internes derrière reverse proxy

Stylimag doit rendre cette distinction explicite plutôt qu'accidentelle.

### Recommandation 7 : trancher si GraphQL doit exécuter `start` ou `prod`

Cela doit relever d'une politique, pas de la dérive.

Questions à trancher :

- le compose actif est-il strictement destiné à un usage type développement ?
- est-ce un chemin production allégé ?
- les flags de durcissement production de `prod` sont-ils nécessaires pour les déploiements Stylimag ?

Une fois la décision prise, utiliser un seul script intentionnellement et documenter le choix.

### Recommandation 8 : clarifier la stratégie d'export

Si l'export doit rester partie intégrante de Stylimag, la pile active est incomplète et doit être étendue.

Si l'export doit être externalisé, Stylimag devrait documenter :

- quel service externe est attendu
- quelles variables d'environnement ou endpoints sont requis
- quelles fonctionnalités se dégradent en absence d'export

C'est actuellement l'une des plus grandes questions d'architecture non résolues.

### Recommandation 9 : ajouter une courte ADR d'architecture

Stylimag bénéficierait d'une note ADR courte expliquant :

- pourquoi le proxy same-origin a été adopté
- pourquoi l'export est inclus ou non dans la pile active
- pourquoi les assets frontend sont maintenant construits dans Docker
- quels modes de déploiement sont officiellement supportés

Cela éviterait aux futures contributions de devoir reconstruire l'intention à partir des fichiers compose.

## Feuille de route d'implémentation suggérée

### Immédiat

- mettre à jour le README pour refléter le compose actif
- marquer `docker-compose.old.yaml` comme historique ou le renommer de manière plus explicite
- corriger `docker-compose.local.yaml` pour qu'il corresponde aux noms de services actifs
- ajouter un paragraphe expliquant si l'export est volontairement exclu

### Court terme

- choisir soit un chemin compose canonique unique, soit une structure multi-mode à base de profils
- aligner les références Docker du workflow GitHub sur le chemin compose choisi
- restaurer les healthchecks et conditions de dépendance au démarrage là où nécessaire
- revoir les bindings de ports pour un comportement le moins surprenant possible

### Moyen terme

- décider si Stylimag doit porter un récit de déploiement complet ou seulement un récit applicatif
- si le déploiement complet reste un objectif, réintroduire export et pandoc de manière cohérente
- sinon, documenter clairement les dépendances et frontières des services externes
- ajouter une ADR ou note d'architecture liée depuis le README

## Vérifications qualité suggérées

Après clarification de l'architecture, valider le modèle avec une checklist simple.

- un démarrage local à neuf depuis le README fonctionne tel qu'écrit
- les fichiers d'override compose s'appliquent toujours correctement
- les flux login frontend et session fonctionnent via le proxy same-origin
- GraphQL démarre de façon fiable même sur une machine lente
- le comportement export est soit supporté et testé, soit explicitement indisponible
- la CI build les mêmes services que ceux que la documentation demande d'exécuter

## Position finale

La direction Docker active de Stylimag est raisonnable, et à certains égards meilleure que le pattern Stylo hérité. Le problème principal n'est pas la nouvelle architecture elle-même. Le problème principal est une consolidation incomplète.

Stylimag devrait désormais faire l'un des deux choix suivants :

- assumer pleinement l'architecture simplifiée et aligner tout le reste dessus
- ou formaliser une architecture double mode pour rendre les modes léger et full-stack intentionnels, documentés et testables

Les deux choix sont défendables. L'état intermédiaire ambigu ne l'est pas.