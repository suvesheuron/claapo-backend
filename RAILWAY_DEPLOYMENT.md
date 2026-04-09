# 🚀 Deploy CrewCall Backend on Railway

## Overview

This guide walks you through deploying the CrewCall backend on **Railway** with:
- ✅ **PostgreSQL database** (Railway managed)
- ✅ **Automatic deployments** on git push
- ✅ **Permanent URL** (no ngrok restarts)
- ✅ **Scalable** (handle 100s-1000s of users)

---

## Step 1: Prepare Your Backend Repository

### 1.1 Push to GitHub (if not already)

```bash
cd D:\my_Codes\euron\clsspo2\crewcall-backend

git add .
git commit -m "initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

---

## Step 2: Create Railway Account & Project

### 2.1 Sign Up
1. Go to [railway.app](https://railway.app)
2. Click **"Login"** → Sign up with **GitHub** (recommended) or email
3. You get **$5 free credit/month** (no credit card needed)

### 2.2 Create New Project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Connect your repository: `crewcall-backend`

---

## Step 3: Configure PostgreSQL Database

Railway will auto-provision PostgreSQL for you!

### 3.1 Add PostgreSQL Service
1. In your Railway project dashboard, click **"+ New"**
2. Select **"Database"** → **"Add PostgreSQL"**
3. Railway creates a PostgreSQL instance automatically

### 3.2 Copy Database URL
1. Click on the **PostgreSQL service**
2. Go to **"Variables"** tab
3. Copy the `DATABASE_URL` value (looks like):
   ```
   postgresql://username:password@host:port/railway?sslmode=require
   ```
4. **Keep this handy** — you'll add it to your app service next

---

## Step 4: Configure Environment Variables

### 4.1 Add Variables to Your App Service

In Railway, click on your **app service** (the one deployed from GitHub), go to **"Variables"** tab, and add:

```env
NODE_ENV=production
PORT=3000
API_BASE_URL=<your-railway-app-url>/v1
CORS_ORIGINS=https://claapo.vercel.app,*

DATABASE_URL=<paste-the-postgresql-url-from-step-3.2>

JWT_SECRET=<generate-a-random-string-here>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<generate-another-random-string>
JWT_REFRESH_EXPIRES_IN=7d

EXPOSE_OTP_IN_API=false

THROTTLE_TTL=60
THROTTLE_LIMIT=100
```

### 4.2 Generate Secure Secrets

**Don't use default secrets in production!** Generate secure values:

```bash
# In PowerShell (Windows):
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

Run it twice — once for `JWT_SECRET`, once for `JWT_REFRESH_SECRET`.

**Example output:**
```
JWT_SECRET=xK9mP2vQ7wR4tY8nL3jH6bF5cD0sA1gZ
JWT_REFRESH_SECRET=mN8pQ3vR7wT2yL5jK9bH4cF6dS0aG1xZ
```

### 4.3 CORS Origins

Update `CORS_ORIGINS` to allow your Vercel frontend:

```env
CORS_ORIGINS=https://claapo.vercel.app,http://localhost:5173
```

**Remove the `*`** for better security in production.

---

## Step 5: Configure Build & Start Commands

Railway auto-detects Node.js, but you need to tell it how to build and start:

### 5.1 In Railway Dashboard → App Service → Settings

**Build Command:**
```bash
npm install && npx prisma generate && npm run build
```

**Start Command:**
```bash
npx prisma migrate deploy && npm run start:prod
```

### 5.2 Alternative: Create `railway.json`

For automatic configuration, create this file in your backend root:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "npx prisma migrate deploy && npm run start:prod",
    "healthcheckPath": "/v1/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

---

## Step 6: Database Migrations

Railway needs to run Prisma migrations to create tables.

### Option A: Automatic (Recommended)
The start command `npx prisma migrate deploy` handles this automatically on every deploy.

### Option B: Manual (First Time)
1. Open Railway dashboard → App Service
2. Click **"Deployments"** → Select latest deployment
3. Open **"Logs"** and watch for migration success
4. If migrations fail, check logs for errors

---

## Step 7: Deploy!

### 7.1 First Deployment
Railway automatically deploys when you connect the repo. If not:

```bash
# Install Railway CLI (optional)
npm i -g @railway/cli

# Login
railway login

# Deploy
railway up
```

### 7.2 Subsequent Deployments
Just push to GitHub:

```bash
git add .
git commit -m "updated backend"
git push
```

Railway **auto-deploys** on every push to `main`!

---

## Step 8: Get Your Backend URL

### 8.1 Find Your URL
1. Go to Railway dashboard → Your project
2. Click on the **app service**
3. Look for **"Domains"** section
4. You'll see: `https://crewcall-backend-xxxx.railway.app`

**This is your permanent backend URL!** (No ngrok restarts)

---

## Step 9: Update Frontend Environment Variables

Now update your Vercel frontend to use the Railway backend:

### 9.1 Update `.env.production`

```env
VITE_API_URL=https://crewcall-backend-xxxx.railway.app/v1
```

### 9.2 Update Vercel Environment Variables

1. Go to [Vercel Dashboard](https://vercel.com/adityaeurons-projects/claapo/settings/environment-variables)
2. Update `VITE_API_URL` to your Railway URL
3. **Redeploy frontend**:
   ```bash
   cd crewcall-frontend
   vercel --prod
   ```

---

## Step 10: Verify Everything Works

### 10.1 Test Backend Health
```bash
curl https://crewcall-backend-xxxx.railway.app/v1/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2026-04-09T..."
}
```

### 10.2 Test Swagger Docs
Open in browser:
```
https://crewcall-backend-xxxx.railway.app/docs
```

You should see the full Swagger API documentation!

### 10.3 Test Frontend
1. Open `https://claapo.vercel.app`
2. Try logging in
3. Check browser DevTools → Network tab
4. All API calls should go to your Railway URL ✅

---

## 🔧 Troubleshooting

### Migration Errors
**Problem:** `Prisma migrate failed`  
**Solution:**
```bash
# In Railway dashboard → Open Shell
npx prisma migrate reset --force
npx prisma migrate deploy
```

### Database Connection Errors
**Problem:** Can't connect to PostgreSQL  
**Solution:**
- Verify `DATABASE_URL` is correct (includes `?sslmode=require`)
- Ensure PostgreSQL service is running in Railway

### CORS Errors
**Problem:** Frontend can't reach backend  
**Solution:**
- Add your Vercel URL to `CORS_ORIGINS`:
  ```env
  CORS_ORIGINS=https://claapo.vercel.app
  ```
- Remove `*` for security

### Port Errors
**Problem:** Port already in use  
**Solution:** Railway sets `PORT` automatically. Don't hardcode it!

---

## 📊 Railway Free Tier Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| **Free Credit** | $5/month | Enough for small apps |
| **RAM** | 512 MB - 1 GB per service | Sufficient for NestJS |
| **CPU** | Shared | Fine for API workloads |
| **Database** | 1 GB storage | ~100K+ users |
| **Bandwidth** | **Unlimited!** | ✅ No ngrok caps! |
| **Custom Domains** | Yes | Free |

**When you exceed $5**, Railway asks you to add a credit card. After that, pay-as-you-go pricing is very cheap (~$0.00023/GB-sec).

---

## 🎯 Optional: Custom Domain

If you want `api.crewcall.in` instead of `crewcall-backend-xxxx.railway.app`:

1. Railway Dashboard → App Service → **Domains**
2. Click **"Add Custom Domain"**
3. Enter `api.crewcall.in`
4. Railway gives you DNS records to add to your domain provider
5. Wait for DNS propagation (up to 48 hrs)

Then update:
```env
# Frontend .env.production
VITE_API_URL=https://api.crewcall.in/v1
```

---

## 🎉 Done!

You now have:
- ✅ **Permanent backend URL** (no restarts)
- ✅ **Unlimited bandwidth** (no 1GB ngrok cap)
- ✅ **Auto-deploy on git push**
- ✅ **Managed PostgreSQL database**
- ✅ **Can handle 100s-1000s of concurrent users**
- ✅ **Production-ready security**

Let me know if you hit any issues during deployment! 🚀
