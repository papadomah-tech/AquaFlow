"""
AquaFlow Manager — SQLite → Supabase Migration Script
======================================================
Run this on the PC where your desktop AquaFlow app is installed.

Requirements:
  pip install supabase python-dotenv

Usage:
  python migrate_from_sqlite.py

Edit the three variables below before running.
"""

import sqlite3, json, sys, os
from datetime import datetime

# ── CONFIGURE THESE ──────────────────────────────────────────────────────────
SQLITE_PATH  = r"C:\Users\papad\AppData\Roaming\AquaFlow Manager\aquaflow.db"  # path to your .db file
SUPABASE_URL = "https://qacfupjeejsahurhsgzs.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhY2Z1cGplZWpzYWh1cmhzZ3pzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE2OTQ4NCwiZXhwIjoyMDk3NzQ1NDg0fQ.LNccNnSnvutVkH25TZIqbRhHkZ2_Ln3bSWUW3myNmVI"      # use SERVICE ROLE key, not anon
# ─────────────────────────────────────────────────────────────────────────────

try:
    from supabase import create_client
except ImportError:
    print("Install required: pip install supabase")
    sys.exit(1)

sb   = create_client(SUPABASE_URL, SUPABASE_KEY)
conn = sqlite3.connect(SQLITE_PATH)
conn.row_factory = sqlite3.Row

def rows(table, order='id'):
    try:
        return [dict(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY {order}").fetchall()]
    except Exception as e:
        print(f"  ⚠️  {table}: {e}")
        return []

def upsert(table, data, conflict='id'):
    if not data: return 0
    # Strip None-value keys that would fail FK checks
    clean = [{k: v for k, v in row.items() if v is not None or k == conflict}
             for row in data]
    try:
        sb.table(table).upsert(clean, on_conflict=conflict).execute()
        return len(clean)
    except Exception as e:
        print(f"  ❌  {table}: {e}")
        return 0

print("\n🚀 AquaFlow SQLite → Supabase Migration")
print("=" * 50)

# Order matters — FK dependencies
TABLES = [
    ('raw_materials',          'id'),
    ('roll_films',             'id'),
    ('employees',              'id'),
    ('customers',              'id'),
    ('raw_material_purchases', 'id'),
    ('raw_material_usage',     'id'),
    ('production_batches',     'id'),
    ('sales',                  'id'),
    ('payments',               'id'),
    ('attendance',             'id'),
    ('salary_payments',        'id'),
    ('employee_losses',        'id'),
    ('expenses',               'id'),
    ('bank_deposits',          'id'),
    ('finished_inventory',     'id'),
    ('stock_takes',            'id'),
    ('stock_take_items',       'id'),
    ('stock_adjustments',      'id'),
]

total = 0
for table, conflict in TABLES:
    data = rows(table)
    if not data:
        print(f"  ⏭️   {table}: empty or not found")
        continue
    n = upsert(table, data, conflict)
    print(f"  ✅  {table}: {n} rows")
    total += n

conn.close()
print(f"\n✅ Migration complete — {total} total rows imported.")
print("Open your Vercel app and verify the data.")
