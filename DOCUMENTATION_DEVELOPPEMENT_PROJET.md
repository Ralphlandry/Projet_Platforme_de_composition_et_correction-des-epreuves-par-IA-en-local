# Guide de réalisation du projet EvalPro

Ce document décrit les étapes de développement du projet de A à Z afin que vous puissiez apprendre par coeur le fonctionnement de l'architecture, expliquer chaque méthode et présenter le projet à votre équipe.

---

## 1. Vision du projet

EvalPro est une plateforme de gestion d'examens en ligne composée de trois services principaux :

- `exam-creator-frontend` : application React/TypeScript pour l'interface utilisateur.
- `exam-backend-fastapi` : API FastAPI exposant les routes métier et gérant la base de données.
- `ia` : service de correction intelligent connecté à Ollama pour corriger les réponses ouvertes.

L'objectif était de créer un cycle complet : création d'examens, publication, passation, correction, notifications et analyse statistique.

---

## 2. Architecture globale

### 2.1 Backend FastAPI

Le backend est organisé en modules clairs :

- `app/main.py` : point d'entrée FastAPI, configuration des middlewares CORS, initialisation de la base et création des tables.
- `app/core/config.py` : chargement des variables d'environnement avec `dotenv`.
- `app/core/security.py` : gestion du hashage de mot de passe, création et lecture de tokens JWT.
- `app/db/session.py` : création de la session SQLAlchemy.
- `app/db/base.py` : modèle de base SQLAlchemy.
- `app/models/entities.py` : définition des entités de la base telles que `Profile`, `Exam`, `Submission`, `Answer`, `Notification`, `UserRole`, etc.
- `app/schemas/` : schémas Pydantic pour valider les requêtes et les réponses.
- `app/api/deps.py` : dépendances FastAPI partagées, en particulier la résolution de l'utilisateur authentifié.
- `app/api/router.py` : agrégation des routeurs de l'API.
- `app/api/routes/` : routes métier (`auth.py`, `db.py`, `exams.py`, `health.py`, `setup.py`, `sse.py`).
- `app/services/` : services métiers réutilisables (`db_ops.py`, `ai_service.py`).

### 2.2 Frontend React

Le frontend contient :

- `src/App.tsx` : configuration du routeur, protection des routes par rôle, providers React.
- `src/lib/backendClient.ts` : client API centralisé pour appeler l'API FastAPI avec le token.
- `src/hooks/` : hooks de contexte pour l'authentification, la langue, le thème, la notification SSE.
- `src/pages/` : pages métier (`Auth`, `Dashboard`, `Exams`, `TakeExam`, `MyExams`, `MyResults`, etc.).
- `src/components/` : composants réutilisables et widgets UI.

### 2.3 Service IA

Le service `ia` expose une API interne pour corriger automatiquement les réponses de type texte. Il se connecte à Ollama et applique de la logique de normalisation des réponses.

---

## 3. Étapes de développement backend

### 3.1 Initialisation du backend

1. Créer un environnement Python (`python -m venv .venv`).
2. Installer les dépendances du backend (`pip install -r requirements.txt`).
3. Ajouter un fichier `.env` pour configurer :
   - `DATABASE_URL`
   - `JWT_SECRET_KEY`
   - `JWT_ALGORITHM`
   - `JWT_EXPIRE_MINUTES`
   - `CORS_ORIGINS`
   - `IA_API_URL`
4. Construire le moteur SQLAlchemy et la session.

### 3.2 Configuration centralisée

- `app/core/config.py` charge les variables d'environnement et expose un objet `settings`.
- Le backend lit ces informations au démarrage.

### 3.3 Sécurité et authentification

- `app/core/security.py` contient :
  - `hash_password(password)` : hash bcrypt du mot de passe.
  - `verify_password(password, hashed)` : vérification du mot de passe.
  - `create_access_token(data)` : génère un JWT avec le payload et l'expiration.
  - `decode_token(token)` : décode le JWT et vérifie sa validité.

- `app/api/deps.py` expose :
  - `parse_auth_token(authorization)` : extrait le Bearer token du header.
  - `get_current_user(authorization, db)` : décode le token, récupère l'utilisateur en base et lève une erreur si le token est invalide.

### 3.4 Modèles et schémas

- `app/models/entities.py` définit toutes les tables en ORM.
- Chaque entité contient les colonnes attendues et les relations utiles.
- `app/schemas/auth.py` et `app/schemas/db.py` valident les payloads de l'API.

### 3.5 Routes Authentification

- `app/api/routes/auth.py` gère :
  - inscription (`signup`) pour les étudiants
  - connexion (`login`)
  - récupération du profil connecté
  - options de rôle disponibles
  - administration des utilisateurs (`create / update role`) pour le rôle admin

Important : la création publique est limitée au rôle `etudiant`; le rôle `admin` est créé avec le script `scripts/create_admin.py`.

### 3.6 Routes CRUD génériques

- `app/api/routes/db.py` est la pierre angulaire du backend.
- Il expose un CRUD générique pour les tables du frontend via :
  - `POST /api/db/query`
  - `POST /api/db/insert`
  - `POST /api/db/update`
  - `POST /api/db/delete`

#### Logique métier dans `db.py`

- Le routeur détecte le rôle de l'utilisateur (`admin`, `professeur`, `etudiant`).
- Il applique :
  - des filtres d'accès pour chaque table
  - des contraintes de périmètre métier
  - une isolation des données pour les professeurs (ils ne voient que leurs propres examens)
  - des accès restreints pour les étudiants (`submissions`, `answers`, `notifications` seulement)

- Pour les étudiants :
  - les examens ne sont visibles que si le profil correspond à la spécialité, au niveau et aux matières autorisées.
  - les réponses ne peuvent être ajoutées ou modifiées que sur leur propre soumission.
  - les notifications ne peuvent être lues/supprimées que par le destinataire.

- Pour les examens :
  - la publication automatique d'un examen programmé est gérée sur le `query`
  - publication et programmation déclenchent la création de notifications aux étudiants et aux administrateurs

- Les méthodes d'audit :
  - `_write_audit()` enregistre une trace d'insertion, mise à jour ou suppression
  - les logs d'audit servent ensuite à l'historique

### 3.7 Routes d'examen spécifiques

- `app/api/routes/exams.py` contient :
  - l'import de questions depuis un PDF
  - la suggestion de réponses via le service IA
  - le déclenchement de la correction automatique d'une soumission

- Méthodes importantes :
  - `_extract_questions_from_text()` : parse du texte PDF pour retrouver questions et options
  - `_build_answer_prompt()` : construction du prompt envoyé à Ollama
  - `_ask_ollama()` : appel HTTP à l'IA
  - `_clean_llm_answer()` : normalisation de la réponse renvoyée

### 3.8 Initialisation et data fixtures

- `app/api/routes/setup.py` initialise les sujets, spécialités et niveaux par défaut.
- `scripts/create_admin.py` permet de créer ou mettre à jour le compte admin initial.

### 3.9 Route SSE

- `app/api/routes/sse.py` expose un flux SSE pour les notifications en temps réel.
- La connexion s'effectue avec un token JWT passé en paramètre de query string.

---

## 4. Étapes de développement frontend

### 4.1 Initialisation du frontend

1. Installer Node.js et npm.
2. Lancer `npm install` dans `exam-creator-frontend`.
3. Configurer `VITE_API_URL` dans `.env` pour pointer vers `http://localhost:8001`.

### 4.2 Point d'entrée React

- `src/App.tsx` : configuration globale.
- `QueryClientProvider` pour `react-query`.
- `AuthProvider`, `ThemeProvider`, `LanguageProvider` pour les contextes du frontend.
- `BrowserRouter` et `Routes` pour les différentes pages.
- `ProtectedRoute` pour empêcher l'accès aux pages selon le rôle.

### 4.3 Gestion de la session et API client

- `src/lib/backendClient.ts` gère :
  - le stockage de la session dans `sessionStorage`
  - l'ajout automatique du header `Authorization: Bearer ...`
  - la centralisation des erreurs API
  - un builder générique pour `select`, `insert`, `update`, `delete`

- Cette logique permet au frontend de consommer l'API CRUD sans dupliquer les appels.

### 4.4 Authentification et rôle

- `src/hooks/useAuth.tsx` est le coeur de l'authentification.
- Il charge la session stockée, récupère le profil via l'API et expose :
  - `user`
  - `role`
  - `login()`
  - `logout()`

- Les pages se basent sur `useAuth()` et sur `ProtectedRoute` pour rediriger automatiquement selon le rôle.

### 4.5 Pages principales

#### 4.5.1 Auth

- `src/pages/Auth.tsx` gère la connexion et l'inscription.
- Elle affiche les erreurs et stocke la session après authentification.

#### 4.5.2 Dashboard

- `src/pages/Dashboard.tsx` présente les tableaux de bord selon le rôle.
- Il peut afficher des statistiques globales, liens rapides et mesures clés.

#### 4.5.3 Exams / MyExams

- `src/pages/Exams.tsx` est la page d'administration des examens pour les professeurs.
- `src/pages/MyExams.tsx` est la page des examens disponibles pour les étudiants.

#### 4.5.4 TakeExam

- `src/pages/TakeExam.tsx` implémente la passation d'examen.
- Logique importante :
  - récupération de l'examen et des questions
  - création ou récupération de `submission` en état `en_cours`
  - calcul du temps restant à partir de `end_date` ou `duration_minutes`
  - sauvegarde automatique
  - dialogue de fin de temps
  - gestion des incidents réseau et anti-triche côté client

- Ce composant est l'un des plus critiques car il doit gérer l'expérience de l'étudiant pendant l'examen.

#### 4.5.5 Resultats et corrections

- `src/pages/MyResults.tsx` et `src/pages/ExamResult.tsx` affichent les notes et le détail des réponses.
- `src/pages/Corrections.tsx` montre la correction automatique / manuelle.

#### 4.5.6 Admin

- Pages `src/pages/admin/*` permettent :
  - gestion des utilisateurs
  - gestion des matières, spécialités, niveaux
  - envoi de notifications
  - consultation des logs d'audit

### 4.6 Composants transverses

- `src/components/ExamHistory.tsx` : affiche l'historique des modifications d'un examen à partir des logs d'audit.
- `src/components/QuestionStats.tsx` : calcule les statistiques de réussite par question.
- Composants UI génériques dans `src/components/ui/` offrent des éléments réutilisables.

---

## 5. Service IA

### 5.1 Objectif

Ce service corrige automatiquement les réponses libres en s'appuyant sur une API d'IA (Ollama + modèle Qwen). Il réduit le travail manuel de correction pour les questions ouvertes.

### 5.2 Démarrage

- installation des dépendances Python
- récupération du modèle Ollama `qwen2.5:3b`
- lancement d'un serveur FastAPI sur le port `8000`

### 5.3 Intégration

- `exam-backend-fastapi` appelle ce service via `IA_API_URL`.
- `app/api/routes/exams.py` prépare un prompt, appelle l'IA et nettoie la réponse.
- `app/services/ai_service.py` contient la logique de correspondance entre réponses, points et normalisation.

---

## 6. Comment expliquer chaque méthode clé à l'équipe

### 6.1 `get_current_user()`

- objectif : authentifier chaque requête protégée
- fonctionne en 3 étapes :
  1. extraction du token Bearer
  2. décodage du JWT
  3. récupération de l'utilisateur en base

### 6.2 `apply_filters()` dans `app/services/db_ops.py`

- objectif : transformer des filtres JSON envoyés par le frontend en requête SQLAlchemy.
- c'est le pont entre le client générique et la requête SQL réelle.

### 6.3 `db_query()` / `db_insert()` / `db_update()` / `db_delete()`

- objectifs : centraliser le CRUD et éviter de multiplier les endpoints.
- chaque méthode applique les règles de sécurité en fonction du rôle.
- elle sérialise les résultats, hydrate les relations et écrit les logs d'audit.

### 6.4 `TakeExam` (frontend)

- objectif : proposer une interface de passation d'examen robuste.
- gère :
  - la récupération des données depuis l'API
  - le chronomètre
  - la soumission automatique quand le temps est écoulé
  - les warnings à 5 et 1 minute
  - la création / récupération de `submission`

### 6.5 `backendClient.ts`

- objectif : normaliser les appels HTTP vers l'API backend.
- centralise l'envoi des headers, la lecture du token et la gestion des erreurs.
- simplifie l'appel CRUD depuis tous les composants.

### 6.6 `ExamHistory` et `QuestionStats`

- `ExamHistory` analyse les entrées `audit_logs` et traduit les changements pour l'interface.
- `QuestionStats` calcule les performances sur chaque question à partir des réponses et des notes.

---

## 7. Ordre recommandé de présentation lors d'une démo

1. Présenter l'architecture en 3 services.
2. Montrer la structure des dossiers backend et frontend.
3. Expliquer le rôle de l'authentification et des rôles.
4. Montrer la création d'un examen côté professeur.
5. Faire une démonstration de passation d'examen côté étudiant.
6. Expliquer la correction automatique IA.
7. Montrer les notifications et l'historique d'audit.
8. Terminer par les statistiques de réussite et la page admin.

---

## 8. Commandes utiles

```powershell
# Backend
cd exam-backend-fastapi
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# Frontend
cd exam-creator-frontend
npm install
npm run dev

# IA
cd ia
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
ollama pull qwen2.5:3b
uvicorn ia_correction.api:app --reload --port 8000
```

---

## 9. Résumé de l'organisation des fichiers

- `exam-backend-fastapi/app/main.py` : démarrage du backend
- `exam-backend-fastapi/app/core/config.py` : configuration `.env`
- `exam-backend-fastapi/app/core/security.py` : JWT et mots de passe
- `exam-backend-fastapi/app/api/deps.py` : dépendances auth
- `exam-backend-fastapi/app/api/routes/` : endpoints CRUD, auth, examens, setup, SSE
- `exam-backend-fastapi/app/services/` : logique réutilisable métiers
- `exam-backend-fastapi/app/models/entities.py` : définition des tables
- `exam-creator-frontend/src/App.tsx` : routage et protection des pages
- `exam-creator-frontend/src/lib/backendClient.ts` : client API et session
- `exam-creator-frontend/src/hooks/` : gestion auth / langue / thème / SSE
- `exam-creator-frontend/src/pages/` : vues métier
- `exam-creator-frontend/src/components/` : widgets réutilisables

---

## 10. Conseils pour mémoriser

- Visualisez le flux : authentification → CRUD → examen → correction → notifications.
- Souvenez-vous que le backend expose un CRUD générique, pas des endpoints spécifiques pour chaque table.
- Le rôle utilisateur (`admin`, `professeur`, `etudiant`) est la clé de toutes les règles d'accès.
- Le frontend utilise un client API centralisé et des guards de route pour sécuriser l'interface.
- L'IA est un service séparé, appelé depuis les examens et responsable des réponses textuelles.

Bonne présentation à ton équipe ! Ce document te permettra d'expliquer clairement pourquoi chaque module existe et comment les données circulent du frontend vers le backend et vers le service IA.
