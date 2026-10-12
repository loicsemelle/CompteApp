import os
import sqlite3
import json
from datetime import datetime

DATABASE_PATH = os.environ.get("DATABASE_PATH", "data/db/config.db")

def get_db_connection():
    db_dir = os.path.dirname(DATABASE_PATH)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Table for Woob backends
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS backends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        module TEXT NOT NULL,
        config TEXT NOT NULL,
        active INTEGER DEFAULT 1
    )
    """)
    
    # 2. Table for settings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    
    # 3. Table for sync logs
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT
    )
    """)

    # 4. Table for bank accounts
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        backend_name TEXT NOT NULL,
        label TEXT NOT NULL,
        balance REAL NOT NULL,
        type TEXT DEFAULT 'courant', -- courant, livret, investissement, pret, autre
        last_sync TEXT,
        include_in_budget_and_list INTEGER DEFAULT 1,
        rate REAL DEFAULT 3.0
    )
    """)
    
    try:
        cursor.execute("ALTER TABLE accounts ADD COLUMN include_in_budget_and_list INTEGER DEFAULT 1")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("ALTER TABLE accounts ADD COLUMN rate REAL DEFAULT 3.0")
    except sqlite3.OperationalError:
        pass

    # 5. Table for categories
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- Revenu, Dépense fixe, Dépense variable, Transfert
        monthly_budget REAL DEFAULT 0.0
    )
    """)

    # 6. Table for transactions
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        date TEXT NOT NULL,
        rdate TEXT,
        label TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL, -- Revenu, Dépense fixe, Dépense variable, Transfert
        category TEXT,
        note TEXT,
        checked INTEGER DEFAULT 0, -- 0 = non pointée, 1 = pointée
        decalage INTEGER DEFAULT 0, -- 0 = normal, 1 = mois décalé
        sync_timestamp TEXT,
        coming INTEGER DEFAULT 0, -- 0 = finalized, 1 = coming/pending
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        FOREIGN KEY(category) REFERENCES categories(name) ON UPDATE CASCADE
    )
    """)

    # 7. Table for auto-categorization rules
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categorization_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        FOREIGN KEY(category) REFERENCES categories(name) ON DELETE CASCADE
    )
    """)

    # 7.5. Table for month-specific budgets
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS monthly_budgets (
        category_name TEXT NOT NULL,
        month TEXT NOT NULL,
        budget REAL NOT NULL,
        PRIMARY KEY (category_name, month),
        FOREIGN KEY (category_name) REFERENCES categories(name) ON DELETE CASCADE
    )
    """)

    # 8. Table for savings rates (Epargne Tableau2)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS savings_rates (
        account_type TEXT PRIMARY KEY, -- Livret A, LDD, LEP
        rate REAL DEFAULT 0.0
    )
    """)

    # Table for month-specific savings rates
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS monthly_savings_rates (
        account_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        rate REAL NOT NULL,
        PRIMARY KEY (account_id, year, month),
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    )
    """)

    # 9. Table for loan details
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS loan_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        rate REAL NOT NULL,
        duration_months INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        monthly_payment REAL NOT NULL,
        insurance REAL DEFAULT 0.0,
        account_id TEXT,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
    )
    """)
    
    try:
        cursor.execute("ALTER TABLE loan_details ADD COLUMN insurance REAL DEFAULT 0.0")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("ALTER TABLE loan_details ADD COLUMN account_id TEXT")
    except sqlite3.OperationalError:
        pass

    # Insert default categories
    default_categories = [
        # Incomes
        ("Salaire 1", "Revenu", 0.0),
        ("Salaire 2", "Revenu", 0.0),
        ("Allocations", "Revenu", 0.0),
        ("Déblocage épargne", "Revenu", 0.0),
        ("Mandataire", "Revenu", 0.0),
        ("France Travail", "Revenu", 0.0),
        ("Prime", "Revenu", 0.0),
        ("Remboursement Secu", "Revenu", 0.0),
        ("Remboursement Mutuelle", "Revenu", 0.0),
        ("Remboursement Autre", "Revenu", 0.0),
        ("Autre", "Revenu", 0.0),
        ("Deblocage pret", "Revenu", 0.0),
        ("Interets", "Revenu", 0.0),
        # Fixed Expenses
        ("Crédit immobilier", "Dépense fixe", 0.0),
        ("Assurance credit", "Dépense fixe", 0.0),
        ("Electricité", "Dépense fixe", 0.0),
        ("Eau", "Dépense fixe", 0.0),
        ("Taxe foncière", "Dépense fixe", 0.0),
        ("Crédit auto", "Dépense fixe", 0.0),
        ("Matmut", "Dépense fixe", 0.0),
        ("Tesla premium", "Dépense fixe", 0.0),
        ("Cotisation banque", "Dépense fixe", 0.0),
        ("Mutuelle", "Dépense fixe", 0.0),
        ("Téléphone mobile", "Dépense fixe", 0.0),
        ("Internet", "Dépense fixe", 0.0),
        ("Google one", "Dépense fixe", 0.0),
        ("Disney+", "Dépense fixe", 0.0),
        ("Parking", "Dépense fixe", 0.0),
        ("Argent de poche", "Dépense fixe", 0.0),
        ("github", "Dépense fixe", 0.0),
        ("entretien clim", "Dépense fixe", 0.0),
        ("Lycee STAM", "Dépense fixe", 0.0),
        ("renault", "Dépense fixe", 0.0),
        # Variable Expenses
        ("Courses alimentaires", "Dépense variable", 0.0),
        ("Entretien maison", "Dépense variable", 0.0),
        ("Saint Loubes", "Dépense variable", 0.0),
        ("Restaurant", "Dépense variable", 0.0),
        ("Recharge Voiture", "Dépense variable", 0.0),
        ("Pharmacie", "Dépense variable", 0.0),
        ("Médecin", "Dépense variable", 0.0),
        ("Travaux", "Dépense variable", 0.0),
        ("Ameublement / Décoration", "Dépense variable", 0.0),
        ("Loisirs", "Dépense variable", 0.0),
        ("Fêtes/anniversaires", "Dépense variable", 0.0),
        ("Vacances", "Dépense variable", 0.0),
        ("Habillement", "Dépense variable", 0.0),
        ("Beauté", "Dépense variable", 0.0),
        ("Jouets/Cadeaux", "Dépense variable", 0.0),
        ("Livres", "Dépense variable", 0.0),
        ("Animaux", "Dépense variable", 0.0),
        ("Divers", "Dépense variable", 0.0),
        ("Articles de sport", "Dépense variable", 0.0),
        ("Entretien voiture", "Dépense variable", 0.0),
        ("Sport", "Dépense variable", 0.0),
        ("Opticien", "Dépense variable", 0.0),
        ("Autoroute", "Dépense variable", 0.0),
        ("Stationnement", "Dépense variable", 0.0),
        ("Transports", "Dépense variable", 0.0),
        ("Jeux d'argent", "Dépense variable", 0.0),
        ("Granulés", "Dépense variable", 0.0),
        ("Location voiture", "Dépense variable", 0.0),
        ("Achats Important", "Dépense variable", 0.0),
        ("Frais Bancaire", "Dépense variable", 0.0),
        ("cantine college", "Dépense variable", 0.0),
        ("don", "Dépense variable", 0.0),
        # Transferts
        ("Transfert", "Transfert", 0.0)
    ]

    # Insert default categories only once
    cursor.execute("SELECT value FROM settings WHERE key = 'default_categories_loaded'")
    if not cursor.fetchone():
        for cat_name, cat_type, budget in default_categories:
            cursor.execute("""
            INSERT INTO categories (name, type, monthly_budget)
            VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET type=excluded.type
            """, (cat_name, cat_type, budget))
        cursor.execute("INSERT INTO settings (key, value) VALUES ('default_categories_loaded', '1')")

    # Insert default categorization rules
    default_rules = [
        ("CARREFOUR", "Courses alimentaires", "Dépense variable"),
        ("LECLERC", "Courses alimentaires", "Dépense variable"),
        ("AUCHAN", "Courses alimentaires", "Dépense variable"),
        ("LIDL", "Courses alimentaires", "Dépense variable"),
        ("ALDI", "Courses alimentaires", "Dépense variable"),
        ("SUPER U", "Courses alimentaires", "Dépense variable"),
        ("MONOPRIX", "Courses alimentaires", "Dépense variable"),
        ("TESLA", "Recharge Voiture", "Dépense variable"),
        ("IONITY", "Recharge Voiture", "Dépense variable"),
        ("TOTAL", "Recharge Voiture", "Dépense variable"),
        ("AMAZON", "Divers", "Dépense variable"),
        ("SALAIRE", "Salaire 1", "Revenu"),
        ("CAF", "Allocations", "Revenu"),
        ("NETFLIX", "Disney+", "Dépense fixe"),
        ("DISNEY", "Disney+", "Dépense fixe"),
        ("SPOTIFY", "Internet", "Dépense fixe"),
        ("FREE MOBILE", "Téléphone mobile", "Dépense fixe"),
        ("SOSH", "Téléphone mobile", "Dépense fixe"),
        ("ORANGE", "Internet", "Dépense fixe"),
        ("EDF", "Electricité", "Dépense fixe"),
        ("ENGIE", "Electricité", "Dépense fixe"),
        ("VEOLIA", "Eau", "Dépense fixe"),
        ("SAUR", "Eau", "Dépense fixe"),
        ("CPAM", "Remboursement Secu", "Revenu"),
        ("MUTUELLE", "Remboursement Mutuelle", "Revenu"),
        ("GITHUB", "github", "Dépense fixe"),
        ("MATMUT", "Matmut", "Dépense fixe")
    ]

    # Insert default rules only once
    cursor.execute("SELECT value FROM settings WHERE key = 'default_rules_loaded'")
    if not cursor.fetchone():
        for pattern, category, r_type in default_rules:
            cursor.execute("""
            INSERT INTO categorization_rules (pattern, category, type)
            VALUES (?, ?, ?)
            ON CONFLICT(pattern) DO UPDATE SET category=excluded.category, type=excluded.type
            """, (pattern, category, r_type))
        cursor.execute("INSERT INTO settings (key, value) VALUES ('default_rules_loaded', '1')")

    # Initialize default savings interest rates
    default_rates = [
        ("Livret A", 3.0),
        ("LDD", 3.0),
        ("LEP", 4.0)
    ]
    for acc_type, rate in default_rates:
        cursor.execute("""
        INSERT INTO savings_rates (account_type, rate)
        VALUES (?, ?)
        ON CONFLICT(account_type) DO UPDATE SET rate=excluded.rate
        """, (acc_type, rate))

    # Initialize Pret Boursorama if empty
    cursor.execute("SELECT COUNT(*) as count FROM loan_details")
    if cursor.fetchone()["count"] == 0:
        cursor.execute("""
        INSERT INTO loan_details (name, amount, rate, duration_months, start_date, monthly_payment)
        VALUES (?, ?, ?, ?, ?, ?)
        """, ("Prêt Boursorama", 30000.0, 1.66, 48, "2025-10-15", 646.44))

    # Migration: add coming column if it doesn't exist
    try:
        cursor.execute("ALTER TABLE transactions ADD COLUMN coming INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()

# Backend Config Operations
def get_backends():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, module, config, active FROM backends")
    rows = cursor.fetchall()
    conn.close()
    
    backends = []
    for r in rows:
        backends.append({
            "id": r["id"],
            "name": r["name"],
            "module": r["module"],
            "config": json.loads(r["config"]),
            "active": bool(r["active"])
        })
    return backends

def save_backend(name, module, config_dict, active=True):
    conn = get_db_connection()
    cursor = conn.cursor()
    config_json = json.dumps(config_dict)
    
    cursor.execute("""
    INSERT INTO backends (name, module, config, active)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
        module=excluded.module,
        config=excluded.config,
        active=excluded.active
    """, (name, module, config_json, 1 if active else 0))
    
    conn.commit()
    conn.close()

def delete_backend(name):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM backends WHERE name = ?", (name,))
    conn.commit()
    conn.close()

# Settings Operations
def get_setting(key, default=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return row["value"]
    return default

def set_setting(key, value):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
    """, (key, str(value)))
    conn.commit()
    conn.close()

# Logs Operations
def add_log(status, message, details=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    timestamp = datetime.now().isoformat()
    cursor.execute("""
    INSERT INTO sync_logs (timestamp, status, message, details)
    VALUES (?, ?, ?, ?)
    """, (timestamp, status, message, details))
    conn.commit()
    conn.close()

def get_logs(limit=100):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, timestamp, status, message, details FROM sync_logs ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    logs = []
    for r in rows:
        logs.append({
            "id": r["id"],
            "timestamp": r["timestamp"],
            "status": r["status"],
            "message": r["message"],
            "details": r["details"]
        })
    return logs

def clear_logs():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sync_logs")
    conn.commit()
    conn.close()

# Account Operations
def save_account(account_id, backend_name, label, balance, account_type="courant"):
    conn = get_db_connection()
    cursor = conn.cursor()
    last_sync = datetime.now().isoformat()
    
    # Guess default rate by label name
    default_rate = 3.0
    lbl_upper = label.upper()
    if "LEP" in lbl_upper:
        default_rate = 4.0
    elif "LDD" in lbl_upper or "DEVELOPPEMENT DURABLE" in lbl_upper:
        default_rate = 3.0
    
    cursor.execute("""
    INSERT INTO accounts (id, backend_name, label, balance, type, last_sync, rate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        backend_name=excluded.backend_name,
        balance=excluded.balance,
        type=CASE WHEN accounts.type = 'courant' AND excluded.type != 'courant' THEN excluded.type ELSE accounts.type END,
        last_sync=excluded.last_sync
    """, (account_id, backend_name, label, balance, account_type, last_sync, default_rate))
    
    conn.commit()
    conn.close()

def get_accounts():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, backend_name, label, balance, type, last_sync, include_in_budget_and_list, rate FROM accounts")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_account_type(account_id, account_type):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE accounts SET type = ? WHERE id = ?", (account_type, account_id))
    conn.commit()
    conn.close()

def update_account_budget_flag(account_id, include_flag):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE accounts SET include_in_budget_and_list = ? WHERE id = ?", (1 if include_flag else 0, account_id))
    conn.commit()
    conn.close()

# Category Operations
def get_categories():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name, type, monthly_budget FROM categories ORDER BY type, name")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_category(name, cat_type, monthly_budget=0.0):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO categories (name, type, monthly_budget)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
        type=excluded.type,
        monthly_budget=excluded.monthly_budget
    """, (name, cat_type, monthly_budget))
    conn.commit()
    conn.close()

def delete_category(name):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM categories WHERE name = ?", (name,))
    conn.commit()
    conn.close()

def rename_category_in_db(old_name, new_name):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Update category itself
        cursor.execute("UPDATE categories SET name = ? WHERE name = ?", (new_name, old_name))
        # Update transactions referencing it
        cursor.execute("UPDATE transactions SET category = ? WHERE category = ?", (new_name, old_name))
        # Update monthly budgets referencing it
        cursor.execute("UPDATE monthly_budgets SET category_name = ? WHERE category_name = ?", (new_name, old_name))
        # Update categorization rules referencing it
        cursor.execute("UPDATE categorization_rules SET category = ? WHERE category = ?", (new_name, old_name))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

# Rule Operations
def get_rules():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, pattern, category, type FROM categorization_rules ORDER BY pattern")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_rule(pattern, category, r_type):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO categorization_rules (pattern, category, type)
    VALUES (?, ?, ?)
    ON CONFLICT(pattern) DO UPDATE SET
        category=excluded.category,
        type=excluded.type
    """, (pattern, category, r_type))
    conn.commit()
    conn.close()

def delete_rule(rule_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM categorization_rules WHERE id = ?", (rule_id,))
    conn.commit()
    conn.close()

# Transaction Operations
def save_transactions(transactions):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT pattern, category, type FROM categorization_rules")
    rules = [(row["pattern"].upper(), row["category"], row["type"]) for row in cursor.fetchall()]
    
    inserted_count = 0
    for t in transactions:
        t_id = t["id"]
        account_id = t["account_id"]
        date = t["date"]
        rdate = t.get("rdate")
        label = t["label"]
        amount = t["amount"]
        
        category = t.get("category")
        tr_type = t.get("type")
        
        if not category or category == "None" or category == "":
            label_upper = label.upper()
            matched = False
            for pattern, cat, typ in rules:
                if pattern in label_upper:
                    category = cat
                    tr_type = typ
                    matched = True
                    break
            
            if not matched:
                if amount > 0:
                    tr_type = "Revenu"
                    category = "Autre"
                else:
                    tr_type = "Dépense variable"
                    category = "Divers"
        
        if not tr_type:
            tr_type = "Revenu" if amount > 0 else "Dépense variable"
            
        sync_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        coming_val = 1 if t.get("coming") else 0
        cursor.execute("""
        INSERT INTO transactions (id, account_id, date, rdate, label, amount, type, category, note, checked, decalage, sync_timestamp, coming)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            sync_timestamp=excluded.sync_timestamp,
            coming=excluded.coming
        """, (t_id, account_id, date, rdate, label, amount, tr_type, category, t.get("note", ""), t.get("checked", 0), t.get("decalage", 0), sync_timestamp, coming_val))
        inserted_count += 1
            
    conn.commit()
    conn.close()
    return inserted_count

def get_transactions(limit=1000, offset=0, search=None, account_id=None, category=None, tr_type=None, date_from=None, date_to=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
        SELECT t.id, t.account_id, t.date, t.rdate, t.label, t.amount, t.type, t.category, t.note, t.checked, t.decalage, t.sync_timestamp,
               a.label as account_label
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE a.include_in_budget_and_list = 1
    """
    params = []
    
    if search:
        query += " AND t.label LIKE ?"
        params.append(f"%{search}%")
    if account_id:
        query += " AND t.account_id = ?"
        params.append(account_id)
    if category:
        query += " AND t.category = ?"
        params.append(category)
    if tr_type:
        query += " AND t.type = ?"
        params.append(tr_type)
    if date_from:
        query += " AND t.date >= ?"
        params.append(date_from)
    if date_to:
        query += " AND t.date <= ?"
        params.append(date_to)
        
    query += " ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    count_query = """
        SELECT COUNT(*) as count 
        FROM transactions t 
        JOIN accounts a ON t.account_id = a.id
        WHERE a.include_in_budget_and_list = 1
    """
    count_params = []
    if search:
        count_query += " AND t.label LIKE ?"
        count_params.append(f"%{search}%")
    if account_id:
        count_query += " AND t.account_id = ?"
        count_params.append(account_id)
    if category:
        count_query += " AND t.category = ?"
        count_params.append(category)
    if tr_type:
        count_query += " AND t.type = ?"
        count_params.append(tr_type)
    if date_from:
        count_query += " AND t.date >= ?"
        count_params.append(date_from)
    if date_to:
        count_query += " AND t.date <= ?"
        count_params.append(date_to)
        
    cursor.execute(count_query, count_params)
    total_count = cursor.fetchone()["count"]
    
    conn.close()
    return [dict(r) for r in rows], total_count

def update_transaction(t_id, category=None, note=None, checked=None, decalage=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    updates = []
    params = []
    
    if category is not None:
        updates.append("category = ?")
        params.append(category)
        
        cursor.execute("SELECT type FROM categories WHERE name = ?", (category,))
        row = cursor.fetchone()
        if row:
            updates.append("type = ?")
            params.append(row["type"])
            
    if note is not None:
        updates.append("note = ?")
        params.append(note)
    if checked is not None:
        updates.append("checked = ?")
        params.append(1 if checked else 0)
    if decalage is not None:
        updates.append("decalage = ?")
        params.append(1 if decalage else 0)
        
    if updates:
        query = f"UPDATE transactions SET {', '.join(updates)} WHERE id = ?"
        params.append(t_id)
        cursor.execute(query, params)
        conn.commit()
        
    conn.close()

# Savings Rates Operations
def get_savings_rates():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT account_type, rate FROM savings_rates")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_savings_rate(account_type, rate):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO savings_rates (account_type, rate)
    VALUES (?, ?)
    ON CONFLICT(account_type) DO UPDATE SET rate=excluded.rate
    """, (account_type, rate))
    conn.commit()
    conn.close()

# Loan Operations
def get_loans():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, amount, rate, duration_months, start_date, monthly_payment, insurance, account_id FROM loan_details")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_loan(name, amount, rate, duration_months, start_date, monthly_payment, insurance=0.0, account_id=None, loan_id=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if loan_id:
        cursor.execute("""
        UPDATE loan_details SET
            name=?, amount=?, rate=?, duration_months=?, start_date=?, monthly_payment=?, insurance=?, account_id=?
        WHERE id=?
        """, (name, amount, rate, duration_months, start_date, monthly_payment, insurance, account_id, loan_id))
    else:
        cursor.execute("""
        INSERT INTO loan_details (name, amount, rate, duration_months, start_date, monthly_payment, insurance, account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (name, amount, rate, duration_months, start_date, monthly_payment, insurance, account_id))
    conn.commit()
    conn.close()

def delete_loan(loan_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM loan_details WHERE id = ?", (loan_id,))
    conn.commit()
    conn.close()

def save_monthly_budget(category_name, month, budget):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO monthly_budgets (category_name, month, budget)
    VALUES (?, ?, ?)
    ON CONFLICT(category_name, month) DO UPDATE SET budget=excluded.budget
    """, (category_name, month, budget))
    conn.commit()
    conn.close()

def save_imported_transactions(account_id, parsed_transactions):
    import hashlib
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Fetch categorization rules
    cursor.execute("SELECT pattern, category, type FROM categorization_rules")
    rules = [(row["pattern"].upper(), row["category"], row["type"]) for row in cursor.fetchall()]
    
    imported_count = 0
    incoming_sig_counts = {}
    sync_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    for t in parsed_transactions:
        t_date = t["date"]
        label = t["label"]
        amount = float(t["amount"])
        fitid = t.get("fitid")
        
        # Determine ID
        if fitid:
            tr_id = f"fitid_{fitid}"
        else:
            # Generate stable ID
            key = (t_date, label, amount)
            count = incoming_sig_counts.get(key, 0)
            incoming_sig_counts[key] = count + 1
            hash_input = f"{account_id}_{t_date}_{amount}_{label}_{count}"
            tr_id = "stable_" + hashlib.md5(hash_input.encode('utf-8')).hexdigest()[:16]
            
        # Check if this ID or any split part of this ID already exists in the database
        cursor.execute("SELECT 1 FROM transactions WHERE id = ? OR id LIKE ?", (tr_id, f"{tr_id}_split_%"))
        if cursor.fetchone():
            continue # Duplicate, skip
            
        # Categorize
        category = "Divers"
        tr_type = "Dépense variable"
        if amount > 0:
            category = "Autre"
            tr_type = "Revenu"
            
        label_upper = label.upper()
        for pattern, cat, typ in rules:
            if pattern in label_upper:
                category = cat
                tr_type = typ
                break
                
        # Insert
        cursor.execute("""
        INSERT OR IGNORE INTO transactions (id, account_id, date, rdate, label, amount, type, category, note, checked, decalage, sync_timestamp, coming)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0)
        """, (tr_id, account_id, t_date, t_date, label, amount, tr_type, category, "", sync_timestamp))
        if cursor.rowcount > 0:
            imported_count += 1
            
    conn.commit()
    conn.close()
    return imported_count

def save_manual_account(account_id, label, account_type, initial_balance=0.0):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO accounts (id, backend_name, label, balance, type, last_sync, include_in_budget_and_list)
    VALUES (?, 'Manuel', ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
        label=excluded.label,
        type=excluded.type
    """, (account_id, label, initial_balance, account_type, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    conn.commit()
    conn.close()

def split_transaction(transaction_id, parts):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, account_id, date, rdate, label, amount, type, category, note, checked, decalage, sync_timestamp, coming
    FROM transactions WHERE id = ?
    """, (transaction_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise ValueError("Transaction non trouvée.")
        
    orig_tx = dict(row)
    
    parsed_parts = []
    for p in parts:
        if hasattr(p, 'model_dump'):
            parsed_parts.append(p.model_dump())
        elif hasattr(p, 'dict'):
            parsed_parts.append(p.dict())
        elif isinstance(p, dict):
            parsed_parts.append(p)
        else:
            parsed_parts.append({
                "amount": getattr(p, 'amount'),
                "category": getattr(p, 'category', None),
                "note": getattr(p, 'note', None)
            })
            
    total_parts_amount = sum(p["amount"] for p in parsed_parts)
    if round(total_parts_amount, 2) != round(orig_tx["amount"], 2):
        conn.close()
        raise ValueError("La somme des parts doit être égale au montant total de la transaction d'origine.")
        
    if len(parsed_parts) < 2:
        conn.close()
        raise ValueError("Il faut au moins 2 parts pour scinder une transaction.")
        
    # Delete any existing split parts for this transaction
    cursor.execute("DELETE FROM transactions WHERE id LIKE ?", (f"{transaction_id}_split_%",))
    
    # Update the original transaction with the first part
    p1 = parsed_parts[0]
    p1_type = "Revenu" if p1["amount"] >= 0 else ("Dépense fixe" if orig_tx["type"] == "Dépense fixe" else "Dépense variable")
    if p1["amount"] * orig_tx["amount"] < 0:
        p1_type = "Revenu" if p1["amount"] >= 0 else "Dépense variable"
    else:
        p1_type = orig_tx["type"]
        
    cursor.execute("""
    UPDATE transactions
    SET amount = ?, category = ?, note = ?, type = ?
    WHERE id = ?
    """, (p1["amount"], p1["category"], p1["note"], p1_type, transaction_id))
    
    # Insert the rest of the parts as new transactions
    for idx, p in enumerate(parsed_parts[1:], start=2):
        new_id = f"{transaction_id}_split_{idx}"
        p_type = "Revenu" if p["amount"] >= 0 else ("Dépense fixe" if orig_tx["type"] == "Dépense fixe" else "Dépense variable")
        if p["amount"] * orig_tx["amount"] < 0:
            p_type = "Revenu" if p["amount"] >= 0 else "Dépense variable"
        else:
            p_type = orig_tx["type"]
            
        cursor.execute("""
        INSERT INTO transactions (id, account_id, date, rdate, label, amount, type, category, note, checked, decalage, sync_timestamp, coming)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            new_id,
            orig_tx["account_id"],
            orig_tx["date"],
            orig_tx["rdate"],
            f"{orig_tx['label']} (Part {idx})",
            p["amount"],
            p_type,
            p["category"],
            p["note"],
            orig_tx["checked"],
            orig_tx["decalage"],
            orig_tx["sync_timestamp"],
            orig_tx["coming"]
        ))
        
    conn.commit()
    conn.close()

def rename_account(account_id, new_label):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE accounts SET label = ? WHERE id = ?", (new_label, account_id))
    conn.commit()
    conn.close()

def get_monthly_savings_rates(account_id, year):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT month, rate FROM monthly_savings_rates 
        WHERE account_id = ? AND year = ?
    """, (account_id, year))
    rows = cursor.fetchall()
    conn.close()
    return {row["month"]: row["rate"] for row in rows}

def save_monthly_savings_rate(account_id, year, month, rate):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO monthly_savings_rates (account_id, year, month, rate)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, year, month) DO UPDATE SET rate=excluded.rate
    """, (account_id, year, month, rate))
    conn.commit()
    conn.close()

def update_account_rate(account_id, rate):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE accounts SET rate = ? WHERE id = ?", (rate, account_id))
    conn.commit()
    conn.close()

def create_manual_transaction(account_id, date, label, amount, category=None, tr_type=None, note="", checked=0, decalage=0):
    import uuid
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Resolve category & type
    if not category or category == "None" or category == "":
        cursor.execute("SELECT pattern, category, type FROM categorization_rules")
        rules = [(row["pattern"].upper(), row["category"], row["type"]) for row in cursor.fetchall()]
        label_upper = label.upper()
        matched = False
        for pattern, cat, typ in rules:
            if pattern in label_upper:
                category = cat
                tr_type = typ
                matched = True
                break
        if not matched:
            if amount >= 0:
                tr_type = "Revenu"
                category = "Autre"
            else:
                tr_type = "Dépense variable"
                category = "Divers"
    elif not tr_type:
        cursor.execute("SELECT type FROM categories WHERE name = ?", (category,))
        row = cursor.fetchone()
        if row:
            tr_type = row["type"]
        else:
            tr_type = "Revenu" if amount >= 0 else "Dépense variable"
            
    timestamp_slug = datetime.now().strftime("%Y%m%d%H%M%S")
    rand_slug = uuid.uuid4().hex[:8]
    tr_id = f"manual_{timestamp_slug}_{rand_slug}"
    sync_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    cursor.execute("""
    INSERT INTO transactions (id, account_id, date, rdate, label, amount, type, category, note, checked, decalage, sync_timestamp, coming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    """, (tr_id, account_id, date, date, label, amount, tr_type, category, note or "", 1 if checked else 0, 1 if decalage else 0, sync_timestamp))
    
    # Update account balance if account is manual
    cursor.execute("SELECT backend_name FROM accounts WHERE id = ?", (account_id,))
    acc_row = cursor.fetchone()
    if acc_row and acc_row["backend_name"] == "Manuel":
        cursor.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (amount, account_id))
        
    conn.commit()
    conn.close()
    return tr_id

def delete_transaction(transaction_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT account_id, amount FROM transactions WHERE id = ?", (transaction_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise ValueError("Transaction non trouvée.")
        
    account_id = row["account_id"]
    amount = row["amount"]
    
    cursor.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))
    cursor.execute("DELETE FROM transactions WHERE id LIKE ?", (f"{transaction_id}_split_%",))
    
    cursor.execute("SELECT backend_name FROM accounts WHERE id = ?", (account_id,))
    acc_row = cursor.fetchone()
    if acc_row and acc_row["backend_name"] == "Manuel":
        cursor.execute("UPDATE accounts SET balance = balance - ? WHERE id = ?", (amount, account_id))
        
    conn.commit()
    conn.close()



