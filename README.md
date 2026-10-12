# Stock Research Lab

The Express backend has been refactored for local-only, single-user operation. See [backend setup and API](backend-project/README.md) and the [Phase 1 implementation record](docs/PHASE_1_BACKEND.md). From `backend-project/`, run `npm ci`, `npm run build`, then `npm start`; health is at `http://127.0.0.1:7001/api/health`.

The local PostgreSQL/Prisma foundation is available on `127.0.0.1:5437`. Follow [database setup, migrations, tests and backups](docs/DATABASE.md); readiness is `/api/ready`. The application database starts empty.

The frontend has not yet been modernized and still calls removed login and JSON-data APIs. Product requirements are in [PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md); the screenshots and historical README below describe the previous prototype, not currently supported features or setup.

---

# Historical Money Piranha prototype 📈

A full-stack stock market toolkit for experimenting with stock market strategies in a modular, scalable, and UI-driven environment. Built with Express, TypeScript, React, and ECharts.

---

## 🗂 Project Structure

```
stock-market-toolkit/
├── backend-project/    # Express backend with session-based auth and route decorators
└── frontend-project/   # React frontend with Ant Design and ECharts
```

---

## 🔧 Features

- ✅ Session-based login/logout
- 📊 Fetch and display stock price data over time
- 📈 ECharts-powered data visualization
- 🔐 Route protection via custom middleware
- 💡 Uses decorators for clean controller structure (inspired by NestJS)

---

## 📸 App Screenshots

Below are the key user interfaces of the **Money Piranha** web app:

---

### 📝 Sign Up
Create a new account securely with email and password.

![Sign Up Screen](./assets/sign_up.png)

---

### 🔐 Log In
Access your personalized stock dashboard.

![Log In Screen](./assets/login.png)

---

### 📋 Watchlist Dashboard
View and manage your stock watchlist with real-time price and change data.

![Watchlist Dashboard](./assets/dashboard.png)

---

### 📈 Stock Detail Page
Analyze stock trends and chip distribution across time ranges.

![Stock Detail](./assets/stock_detail.png)

---

## ⚙️ Tech Stack
**Frontend**: React, TypeScript, React Router, Ant Design, ECharts

**Backend**: Express, TypeScript, reflect-metadata, cookie-session

**Dev Tools**: ts-node, nodemon, concurrently

---

## 🚀 Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/Shaobangzhu/daytrade-framework.git
cd daytrade-framework
```

### 2. Setup Backend

```bash
cd backend-project
npm install
npm run start
```

- Runs at: `http://localhost:7001`
- Available Endpoints:
  - `POST /api/login`
  - `GET /api/logout`
  - `GET /api/isLogin`
  - `GET /api/getData`
  - `GET /api/showData`

### 3. Setup Frontend

```bash
cd backend-project
npm install
npm run start
```

- Runs at: `http://localhost:3000`
- Pages:
  - `/login` — Login form
  - `/` — Home page with chart and data actions

---

## 📁 Data File
Stock data is saved to:
backend-project/data/prices.json

use Node.js’s path module to resolve the path dynamically:

```bash
import path from 'path';

const filePath = path.resolve(__dirname, '../data/prices.json');

```
This approach works safely across:
- ✅ Windows
- ✅ macOS
- ✅ Linux
- ✅ Varying directory structures

---

## 📌 TODO
- [ ] Add user registration
- [ ] Save user watchlists
- [ ] Store data in a NoSQL database (e.g., MongoDB)
- [ ] Implement trading strategy editor


---

## 📝 License
This project is licensed under the [MIT License](LICENSE).

---

> ⚠️ **Disclaimer**: This is a personal project for educational purposes. It is not intended for real-world trading use without further validation, error handling, and security.
