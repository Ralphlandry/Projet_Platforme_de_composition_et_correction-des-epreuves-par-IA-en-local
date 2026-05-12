# EvalPro - Smart Exam Management Platform

## FR - Presentation

EvalPro est une plateforme web complete pour creer, publier, passer, corriger et analyser des examens en ligne.

Le projet est organise en 3 services:

- Frontend web: React + TypeScript
- Backend API: FastAPI + PostgreSQL
- Service IA de correction: FastAPI + Ollama

## EN - Overview

EvalPro is a complete web platform to create, publish, take, grade, and analyze online exams.

The project is split into 3 services:

- Web frontend: React + TypeScript
- Backend API: FastAPI + PostgreSQL
- AI grading service: FastAPI + Ollama

---

## FR - Fonctionnalites principales

- Authentification JWT avec roles: admin, professeur, etudiant
- Gestion complete du cycle de vie des examens
- Correction hybride:
  - Deterministe pour QCM et Vrai/Faux
  - IA pour reponses courtes et longues
- Notifications
- Analytique et statistiques
- Export Excel/PDF
- Interface bilingue FR/EN

## EN - Main features

- JWT authentication with roles: admin, teacher, student
- Full exam lifecycle management
- Hybrid grading:
  - Deterministic for MCQ and True/False
  - AI-assisted for short and long answers
- Notifications
- Analytics and dashboards
- Excel/PDF exports
- Bilingual interface (FR/EN)

---

## FR/EN - Project structure

```text
projet_iut/
|-- exam-creator-frontend/   # React frontend
|-- exam-backend-fastapi/    # Main API and business logic
|-- ia/                      # AI grading microservice
|-- README.md
```

### Default ports

- Frontend: 5173 (sometimes 8080 depending on Vite config)
- Backend API: 8001
- AI service: 8000
- Ollama: 11434
- PostgreSQL: 5432

---

## FR - Prerequis

- Python 3.11+ (3.12 recommande)
- Node.js 18+ (npm inclus)
- PostgreSQL 14+
- Ollama

Verification rapide:

```powershell
python --version
node --version
npm --version
psql --version
ollama --version
```

## EN - Prerequisites

- Python 3.11+ (3.12 recommended)
- Node.js 18+ (npm included)
- PostgreSQL 14+
- Ollama

Quick check:

```powershell
python --version
node --version
npm --version
psql --version
ollama --version
```

---

## FR - Installation complete (Windows)

### 1) Configurer PostgreSQL

Creer la base et l'utilisateur:

```sql
CREATE DATABASE exam_creator;
CREATE USER exam_user WITH PASSWORD 'exam_pass_123';
GRANT ALL PRIVILEGES ON DATABASE exam_creator TO exam_user;
```

### 2) Lancer le service IA

```powershell
cd ia
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
ollama pull qwen2.5:3b
uvicorn ia_correction.api:app --reload --port 8000
```

Test:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

### 3) Lancer le backend

Dans un nouveau terminal:

```powershell
cd exam-backend-fastapi
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Verifier et adapter exam-backend-fastapi/.env:

```env
DATABASE_URL=postgresql+psycopg2://exam_user:exam_pass_123@localhost:5432/exam_creator
JWT_SECRET_KEY=change-me-in-production
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440
CORS_ORIGINS=http://localhost:5173,http://localhost:8080
IA_API_URL=http://localhost:8000
```

Demarrer le backend:

```powershell
uvicorn app.main:app --reload --port 8001
```

Initialiser les donnees de base:

```powershell
Invoke-RestMethod -Method Post http://localhost:8001/api/setup/init
```

Creer le premier compte admin:

```powershell
python scripts/create_admin.py --email admin@ecole.com --password Admin123! --full-name "Super Admin"
```

### 4) Lancer le frontend

Dans un troisieme terminal:

```powershell
cd exam-creator-frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Ouvrir ensuite l'URL Vite (souvent http://localhost:5173).

---

## EN - Full installation (Windows)

### 1) Configure PostgreSQL

Create database and user:

```sql
CREATE DATABASE exam_creator;
CREATE USER exam_user WITH PASSWORD 'exam_pass_123';
GRANT ALL PRIVILEGES ON DATABASE exam_creator TO exam_user;
```

### 2) Start AI service

```powershell
cd ia
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
ollama pull qwen2.5:3b
uvicorn ia_correction.api:app --reload --port 8000
```

Health check:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

### 3) Start backend

In a new terminal:

```powershell
cd exam-backend-fastapi
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8001
```

Initialize base data:

```powershell
Invoke-RestMethod -Method Post http://localhost:8001/api/setup/init
```

Create first admin account:

```powershell
python scripts/create_admin.py --email admin@ecole.com --password Admin123! --full-name "Super Admin"
```

### 4) Start frontend

In a third terminal:

```powershell
cd exam-creator-frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open the Vite URL (usually http://localhost:5173).

---

## FR/EN - Quick run order

1. ollama serve (if not already running)
2. AI service on port 8000
3. Backend API on port 8001
4. Frontend on port 5173

---

## FR/EN - Docker deployment (recommended for local demos)

A ready-to-use [docker-compose.yml](docker-compose.yml) is provided at the project root.

### FR - Pourquoi Docker ici ?

- Les services ne consomment des ressources que lorsqu'ils sont demarres
- Le profil `ai` permet d'activer Ollama + Qwen seulement quand necessaire
- L'environnement devient reproductible sur un autre PC en une commande

### EN - Why Docker here?

- Services only consume resources when the containers are running
- The `ai` profile enables Ollama + Qwen only when needed
- The environment becomes portable and reproducible on another PC

### Start the project without AI

```powershell
docker compose up -d postgres backend frontend
```

### Start the full project with AI and Ollama/Qwen

```powershell
docker compose --profile ai up -d
```

### First-time initialization

Once the backend is up, initialize base data:

```powershell
Invoke-RestMethod -Method Post http://localhost:8001/api/setup/init
```

### Useful URLs

- Frontend: http://localhost:8080
- Backend docs: http://localhost:8001/docs
- AI health: http://localhost:8000/health
- Ollama API: http://localhost:11434

### Stop everything

```powershell
docker compose down
```

> Note: on the first AI startup, downloading the `qwen2.5:3b` model can take several minutes.

---

## FR/EN - Validation checks

- AI health: http://localhost:8000/health
- Backend Swagger: http://localhost:8001/docs
- Frontend: login page is reachable
- Admin login works with created account

---

## FR/EN - Tests

```powershell
cd exam-backend-fastapi
.\.venv\Scripts\Activate.ps1
python -m pytest tests/ -v
```

---

## FR - Analyse qualite/securite avec SonarQube (local)

Le projet inclut deja une configuration SonarQube locale dans [sonar-project.properties](sonar-project.properties).

### Option A - Serveur SonarQube en Docker (recommande)

1. Lancer SonarQube en local:

```powershell
docker run -d --name sonarqube-local -p 9000:9000 sonarqube:lts-community
```

2. Ouvrir SonarQube:

- URL: http://localhost:9000
- Identifiants initiaux: admin / admin

3. Creer un token utilisateur dans SonarQube:

- My Account -> Security -> Generate Tokens

4. Installer SonarScanner CLI (si non installe), puis lancer le scan depuis la racine du projet:

```powershell
sonar-scanner -Dsonar.host.url=http://localhost:9000 -Dsonar.token=VOTRE_TOKEN
```

### Option B - SonarQube for IDE (analyse dans VS Code)

Tu peux aussi utiliser l'extension SonarQube for IDE pour analyser fichier par fichier pendant le developpement.

---

## EN - Quality/Security analysis with SonarQube (local)

The project already includes a local SonarQube configuration in [sonar-project.properties](sonar-project.properties).

### Option A - Docker SonarQube server (recommended)

1. Start SonarQube locally:

```powershell
docker run -d --name sonarqube-local -p 9000:9000 sonarqube:lts-community
```

2. Open SonarQube:

- URL: http://localhost:9000
- Initial credentials: admin / admin

3. Create a user token:

- My Account -> Security -> Generate Tokens

4. Install SonarScanner CLI (if needed), then run from project root:

```powershell
sonar-scanner -Dsonar.host.url=http://localhost:9000 -Dsonar.token=YOUR_TOKEN
```

### Option B - SonarQube for IDE (in-editor analysis)

You can also use SonarQube for IDE in VS Code to analyze files during development.

---

## FR - Depannage

- CancelledError/KeyboardInterrupt avec Uvicorn: souvent un arret manuel (Ctrl+C) pendant le demarrage en mode --reload.
- Erreur base de donnees: verifier DATABASE_URL, demarrage PostgreSQL, droits utilisateur.
- Erreur Ollama: verifier ollama serve, ollama list, puis ollama pull qwen2.5:3b.
- Erreur CORS/API frontend: verifier VITE_API_URL et CORS_ORIGINS.

## EN - Troubleshooting

- CancelledError/KeyboardInterrupt in Uvicorn: often caused by manual interruption (Ctrl+C) during startup in --reload mode.
- Database errors: verify DATABASE_URL, PostgreSQL service status, and DB user permissions.
- Ollama errors: check ollama serve, ollama list, then ollama pull qwen2.5:3b.
- Frontend API/CORS issues: verify VITE_API_URL and CORS_ORIGINS.

---

## FR/EN - Security note

Before production usage, change secrets (especially JWT_SECRET_KEY), tighten CORS, and set strong database credentials.
