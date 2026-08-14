@echo off
cd /d "%~dp0"

if not exist "backend\node_modules" (
  echo Installing dependencies (first run only)...
  call npm run setup
)
if not exist "frontend\node_modules" (
  call npm run setup
)

if not exist "backend\data\db.json" (
  echo Seeding demo data...
  call npm run seed
)

echo.
echo Starting Chikerito — backend on :4000, frontend on :5173
echo Demo login: demo@chikerito.com / chikerito123
echo.
call npm run dev
