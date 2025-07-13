# SmartQueryAI

A full-stack TypeScript web application that lets you connect to SQL databases, ask questions in natural language, generate safe SQL via OpenAI, execute queries, and browse results—all in one place.

---

## Features

- **Natural-Language to SQL:** Translate user questions into SQL queries with OpenAI (configurable to use local Ollama models).  
- **Multi-Database Support:** Connect to SQL Server or PostgreSQL databases; test connections on the fly.  
- **Query History:** Automatically log every executed query for later review.  
- **Schema-Safe Execution:** Validate generated SQL against a whitelist of commands to prevent dangerous operations.  
- **Full-Stack Type Safety:** Shared Zod/Drizzle schemas between client and server.  
- **Modern UI:** Fast React UI powered by Vite and styled with TailwindCSS.

---

## Tech Stack

| Layer          | Tech                                  |
| -------------- | ------------------------------------- |
| **Frontend**   | React · Vite · TypeScript · TailwindCSS |
| **Backend**    | Express · tsx · TypeScript            |
| **Database**   | PostgreSQL (Neon) · SQL Server · Drizzle ORM · Drizzle-Kit |
| **AI / Embeddings** | OpenAI API · Ollama · Zod · ChromaDB |
| **Bundling & Build** | Vite · esbuild · Drizzle-Kit        |

---

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18  
- A running PostgreSQL or SQL Server instance (for production, Neon is recommended)  
- An OpenAI API key (or local Ollama daemon for `MODEL_NAME`)  
- Optional: [Ollama](https://ollama.com/) running at `OLLAMA_BASE_URL` if using local models  

---

## Getting Started

1. **Clone the repo**  
   ```bash
   git clone https://github.com/<your-username>/SmartQueryAI.git
   cd SmartQueryAI
   ```
2. **Install dependencies**
  ```bash
  npm install
  ```
3. **Configure environment**
Copy .env.example (or create a new .env) and fill in your values:
  ```bash
  # OpenAI  
  OPENAI_API_KEY=sk-...  
  MODEL_NAME=gpt-4o  
  EMBEDDING_MODEL=bge-m3  
  
  # Ollama (if using local LLM)  
  OLLAMA_BASE_URL=http://localhost:11434  
  
  # Persistence  
  PERSIST_DIRECTORY=./chroma_db  
  DOCSTORE_PATH=./docstore.pkl  
  
  # Database (for Drizzle migrations & runtime)  
  DATABASE_URL=postgresql://user:pass@host:port/dbname
  ```
Note: Add your .env file to .gitignore to avoid leaking secrets.

4. **Initialize the database schema**
  ```bash
  npm run db:push
  ```
5. **Run in development**
  ```bash
  npm run dev
  ```
- Server (Express) + Vite client will both run on port 5000.

- Open http://localhost:5000 in your browser.

6. **Build & serve production**
  ```bash
  npm run build
  npm start
  ```
-Builds client assets with Vite, bundles server to dist/index.js, and starts on port 5000.
