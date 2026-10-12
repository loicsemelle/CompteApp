import os
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, File, UploadFile, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from datetime import datetime

import sqlite3
from app.db import (
    init_db,
    get_backends,
    save_backend,
    delete_backend,
    get_setting,
    set_setting,
    get_logs,
    clear_logs,
    add_log,
    get_accounts,
    update_account_type,
    update_account_budget_flag,
    update_account_rate,
    get_categories,
    save_category,
    delete_category,
    rename_category_in_db,
    get_rules,
    save_rule,
    delete_rule,
    get_transactions,
    update_transaction,
    get_savings_rates,
    save_savings_rate,
    get_loans,
    save_loan,
    delete_loan,
    get_db_connection,
    save_monthly_budget,
    get_monthly_savings_rates,
    save_monthly_savings_rate,
    create_manual_transaction,
    delete_transaction
)
from app.sync import run_sync, update_woob_modules
from app.scheduler import start_scheduler, stop_scheduler, configure_job

# FastAPI instance
app = FastAPI(title="CompteApp - Gestion de Finances Personnelles")

# Global task state flags
is_sync_running = False
is_update_running = False

# Models for request validation
class BackendPayload(BaseModel):
    name: str = Field(..., description="Unique backend name")
    module: str = Field(..., description="Woob bank module name")
    config: Dict[str, Any] = Field(..., description="Configuration dictionary containing credentials")
    active: bool = Field(True, description="Whether this backend is active")

class SettingsPayload(BaseModel):
    sync_interval_hours: int = Field(..., ge=0, le=720)

class AccountTypePayload(BaseModel):
    type: str = Field(..., description="Account type: courant, livret, investissement, pret, autre")

class AccountBudgetFlagPayload(BaseModel):
    include: bool = Field(..., description="Whether to include in budget and transaction list")

class CategoryPayload(BaseModel):
    name: str = Field(..., description="Unique category name")
    type: str = Field(..., description="Category type: Revenu, Dépense fixe, Dépense variable, Transfert")
    monthly_budget: float = Field(0.0, description="Monthly budget limit/target")

class RenameCategoryPayload(BaseModel):
    old_name: str = Field(..., description="Original category name")
    new_name: str = Field(..., description="New category name")

class MonthlyBudgetPayload(BaseModel):
    category_name: str = Field(..., description="Category name")
    month: str = Field(..., description="Budget month (YYYY-MM)")
    budget: float = Field(..., description="Monthly budget limit/target")

class RulePayload(BaseModel):
    pattern: str = Field(..., description="Substring to search in labels")
    category: str = Field(..., description="Category to assign")
    type: str = Field(..., description="Type to assign: Revenu, Dépense fixe, Dépense variable, Transfert")

class TransactionUpdatePayload(BaseModel):
    category: Optional[str] = None
    note: Optional[str] = None
    checked: Optional[bool] = None
    decalage: Optional[bool] = None

class CreateTransactionPayload(BaseModel):
    account_id: str = Field(..., description="Target account ID")
    date: str = Field(..., description="Transaction date (YYYY-MM-DD)")
    label: str = Field(..., description="Transaction label / description")
    amount: float = Field(..., description="Amount in EUR (positive for income, negative for expense)")
    category: Optional[str] = None
    type: Optional[str] = None
    note: Optional[str] = None
    checked: bool = False
    decalage: bool = False

class SavingsRatePayload(BaseModel):
    account_type: str = Field(..., description="Savings account type: Livret A, LDD, LEP")
    rate: float = Field(..., description="Applicable interest rate (%)")

class LoanPayload(BaseModel):
    name: str = Field(..., description="Loan name")
    amount: float = Field(..., description="Loan amount borrowed")
    rate: float = Field(..., description="Annual interest rate (%)")
    duration_months: int = Field(..., description="Loan duration in months")
    start_date: str = Field(..., description="Payout date (YYYY-MM-DD)")
    monthly_payment: float = Field(..., description="Monthly payment amount")
    insurance: float = Field(0.0, description="Monthly insurance payment amount")
    account_id: Optional[str] = Field(None, description="Linked synced account ID")
    id: Optional[int] = Field(None, description="Optional ID for updates")

# Lifecycle events
@app.on_event("startup")
async def startup_event():
    init_db()
    start_scheduler()
    add_log("INFO", "Le serveur de gestion de comptes a démarré.")

@app.on_event("shutdown")
async def shutdown_event():
    stop_scheduler()

# Background workers wrappers
def run_sync_task():
    global is_sync_running
    if is_sync_running:
        return
    is_sync_running = True
    try:
        run_sync()
    except Exception as e:
        add_log("FAILED", f"Erreur fatale lors de la synchronisation en arrière-plan : {str(e)}")
    finally:
        is_sync_running = False

def run_update_task():
    global is_update_running
    if is_update_running:
        return
    is_update_running = True
    try:
        update_woob_modules()
    except Exception as e:
        add_log("FAILED", f"Erreur fatale lors de la mise à jour des modules : {str(e)}")
    finally:
        is_update_running = False

# API Status
@app.get("/api/status")
async def get_status():
    return {
        "is_sync_running": is_sync_running,
        "is_update_running": is_update_running,
        "last_sync_status": get_setting("last_sync_status", "NEVER"),
        "last_sync_time": get_setting("last_sync_time", None)
    }

# Backends
@app.get("/api/backends", response_model=List[Dict[str, Any]])
async def get_all_backends():
    return get_backends()

@app.post("/api/backends")
async def add_or_update_backend(payload: BackendPayload):
    try:
        save_backend(
            name=payload.name.strip(),
            module=payload.module.strip(),
            config_dict=payload.config,
            active=payload.active
        )
        return {"status": "success", "message": f"Compte bancaire '{payload.name}' configuré."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'écriture : {str(e)}")

@app.delete("/api/backends/{name}")
async def remove_backend(name: str):
    try:
        delete_backend(name)
        return {"status": "success", "message": f"Compte bancaire '{name}' supprimé."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de suppression : {str(e)}")

@app.get("/api/woob/modules/{module_name}/config")
async def get_module_config(module_name: str):
    from woob.core import Woob
    try:
        w = Woob(workdir="/data/woob", datadir="/data/woob")
        m = w.modules_loader.get_or_load_module(module_name)
        if not m:
            raise HTTPException(status_code=404, detail="Module non trouvé.")
            
        config_defs = []
        for key, val in m.config.items():
            if key in ("login", "password"):
                continue
                
            choices = None
            if hasattr(val, "choices") and val.choices:
                choices = [{"value": k, "label": str(v)} for k, v in val.choices.items()]
                
            config_defs.append({
                "key": key,
                "label": val.label or key,
                "default": val.default,
                "type": "select" if choices else ("password" if "password" in key.lower() or "code" in key.lower() else "text"),
                "choices": choices,
                "required": val.required if hasattr(val, "required") else True
            })
        return config_defs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Scheduler Settings
@app.get("/api/settings")
async def get_all_settings():
    return {
        "sync_interval_hours": int(get_setting("sync_interval_hours", 24))
    }

@app.post("/api/settings")
async def save_settings(payload: SettingsPayload):
    try:
        set_setting("sync_interval_hours", payload.sync_interval_hours)
        configure_job()
        return {"status": "success", "message": "Paramètres enregistrés et planificateur mis à jour."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'écriture des paramètres : {str(e)}")

# Accounts
@app.get("/api/accounts")
async def get_all_accounts():
    return get_accounts()

@app.put("/api/accounts/{account_id}/type")
async def edit_account_type(account_id: str, payload: AccountTypePayload):
    try:
        update_account_type(account_id, payload.type)
        return {"status": "success", "message": "Type de compte mis à jour."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/accounts/{account_id}/budget-flag")
async def edit_account_budget_flag(account_id: str, payload: AccountBudgetFlagPayload):
    try:
        update_account_budget_flag(account_id, payload.include)
        return {"status": "success", "message": "Statut budgétaire du compte mis à jour."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Categories
@app.get("/api/categories")
async def get_all_categories():
    return get_categories()

@app.post("/api/categories")
async def add_or_update_category(payload: CategoryPayload):
    try:
        save_category(payload.name.strip(), payload.type, payload.monthly_budget)
        return {"status": "success", "message": f"Catégorie '{payload.name}' configurée."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/categories/rename")
async def rename_category_route(payload: RenameCategoryPayload):
    try:
        old_n = payload.old_name.strip()
        new_n = payload.new_name.strip()
        if not old_n or not new_n:
            raise HTTPException(status_code=400, detail="Les noms ancien et nouveau sont requis.")
        if old_n == new_n:
            return {"status": "success", "message": "Aucun changement nécessaire."}
        rename_category_in_db(old_n, new_n)
        return {"status": "success", "message": f"Catégorie renommée de '{old_n}' vers '{new_n}'."}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Une catégorie portant ce nom existe déjà.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/monthly-budgets")
async def add_or_update_monthly_budget(payload: MonthlyBudgetPayload):
    try:
        save_monthly_budget(payload.category_name.strip(), payload.month.strip(), payload.budget)
        return {"status": "success", "message": "Budget ponctuel enregistré."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/categories/{name}")
async def remove_category(name: str):
    try:
        delete_category(name)
        return {"status": "success", "message": "Catégorie supprimée."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Rules
@app.get("/api/rules")
async def get_all_rules():
    return get_rules()

@app.post("/api/rules")
async def add_or_edit_rule(payload: RulePayload):
    try:
        save_rule(payload.pattern.strip(), payload.category, payload.type)
        return {"status": "success", "message": "Règle enregistrée."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/rules/{rule_id}")
async def remove_rule(rule_id: int):
    try:
        delete_rule(rule_id)
        return {"status": "success", "message": "Règle supprimée."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Transactions
@app.get("/api/transactions")
async def get_all_transactions(
    limit: int = 100,
    offset: int = 0,
    search: Optional[str] = None,
    account_id: Optional[str] = None,
    category: Optional[str] = None,
    tr_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None
):
    txs, total = get_transactions(
        limit=limit,
        offset=offset,
        search=search,
        account_id=account_id,
        category=category,
        tr_type=tr_type,
        date_from=date_from,
        date_to=date_to
    )
    return {"transactions": txs, "total": total}

@app.post("/api/transactions")
async def api_create_transaction(payload: CreateTransactionPayload):
    try:
        tr_id = create_manual_transaction(
            account_id=payload.account_id,
            date=payload.date,
            label=payload.label.strip(),
            amount=payload.amount,
            category=payload.category,
            tr_type=payload.type,
            note=payload.note or "",
            checked=payload.checked,
            decalage=payload.decalage
        )
        return {"status": "success", "message": "Transaction ajoutée avec succès.", "id": tr_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/transactions/{transaction_id}")
async def api_delete_transaction(transaction_id: str):
    try:
        delete_transaction(transaction_id)
        return {"status": "success", "message": "Transaction supprimée avec succès."}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/transactions/{transaction_id}")
async def edit_transaction(transaction_id: str, payload: TransactionUpdatePayload):
    try:
        update_transaction(
            t_id=transaction_id,
            category=payload.category,
            note=payload.note,
            checked=payload.checked,
            decalage=payload.decalage
        )
        return {"status": "success", "message": "Transaction mise à jour."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transactions/import")
async def import_transactions(
    account_id: str = Form(...),
    file: UploadFile = File(...)
):
    from app.db import save_imported_transactions, save_manual_account, get_accounts
    from app.importer import parse_ofx, parse_csv
    try:
        content = await file.read()
        filename = file.filename.lower()
        
        if filename.endswith(".ofx"):
            res_ofx = parse_ofx(content)
            parsed_txs = res_ofx["transactions"]
            account_info = res_ofx["account_info"]
            
            if account_id == "auto_ofx":
                if not account_info or not account_info["id"]:
                    raise HTTPException(status_code=400, detail="Impossible de détecter automatiquement le compte. Les métadonnées du fichier OFX sont manquantes.")
                
                # Check if account already exists
                accounts = get_accounts()
                existing_ids = [acc["id"] for acc in accounts]
                target_id = account_info["id"]
                if target_id not in existing_ids:
                    save_manual_account(
                        account_id=target_id,
                        label=account_info["label"],
                        account_type=account_info["type"],
                        initial_balance=account_info["balance"]
                    )
                account_id = target_id
        elif filename.endswith(".csv"):
            if account_id == "auto_ofx":
                raise HTTPException(status_code=400, detail="La détection automatique de compte n'est pas supportée pour les fichiers CSV. Veuillez sélectionner un compte ou en créer un.")
            parsed_txs = parse_csv(content)
        else:
            raise HTTPException(status_code=400, detail="Format de fichier non supporté. Veuillez utiliser un fichier OFX ou CSV.")
            
        if not parsed_txs:
            return {"status": "success", "imported_count": 0, "message": "Aucune transaction valide trouvée dans le fichier."}
            
        imported_count = save_imported_transactions(account_id, parsed_txs)
        return {
            "status": "success",
            "imported_count": imported_count,
            "message": f"{imported_count} transactions importées avec succès."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ManualAccountPayload(BaseModel):
    id: str
    label: str
    type: str
    balance: float = 0.0

@app.post("/api/accounts/manual")
async def create_manual_account(payload: ManualAccountPayload):
    try:
        from app.db import save_manual_account
        save_manual_account(
            account_id=payload.id,
            label=payload.label,
            account_type=payload.type,
            initial_balance=payload.balance
        )
        return {"status": "success", "message": "Compte manuel créé avec succès."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SplitPart(BaseModel):
    amount: float
    category: Optional[str] = None
    note: Optional[str] = None

class SplitPayload(BaseModel):
    transaction_id: str
    parts: List[SplitPart]

@app.post("/api/transactions/split")
async def api_split_transaction(payload: SplitPayload):
    try:
        from app.db import split_transaction
        split_transaction(payload.transaction_id, payload.parts)
        return {"status": "success", "message": "Transaction scindée avec succès."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class RenameAccountPayload(BaseModel):
    label: str

@app.put("/api/accounts/{account_id}/rename")
async def api_rename_account(account_id: str, payload: RenameAccountPayload):
    try:
        from app.db import rename_account
        rename_account(account_id, payload.label)
        return {"status": "success", "message": "Compte renommé avec succès."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Savings Rates
class MonthlySavingsRatePayload(BaseModel):
    account_id: str
    year: int
    month: int
    rate: float

@app.post("/api/monthly-savings-rates")
async def edit_monthly_savings_rate(payload: MonthlySavingsRatePayload):
    try:
        save_monthly_savings_rate(payload.account_id, payload.year, payload.month, payload.rate)
        return {"status": "success", "message": "Taux d'intérêt mensuel enregistré."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/savings-rates")
async def get_all_savings_rates():
    return get_savings_rates()

@app.post("/api/savings-rates")
async def edit_savings_rate(payload: SavingsRatePayload):
    try:
        save_savings_rate(payload.account_type, payload.rate)
        return {"status": "success", "message": "Taux d'intérêt enregistré."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Loans
@app.get("/api/loans")
async def get_all_loans():
    return get_loans()

@app.post("/api/loans")
async def add_or_edit_loan(payload: LoanPayload):
    try:
        save_loan(
            name=payload.name.strip(),
            amount=payload.amount,
            rate=payload.rate,
            duration_months=payload.duration_months,
            start_date=payload.start_date,
            monthly_payment=payload.monthly_payment,
            insurance=payload.insurance,
            account_id=payload.account_id,
            loan_id=payload.id
        )
        return {"status": "success", "message": "Crédit enregistré."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/loans/{loan_id}")
async def remove_loan(loan_id: int):
    try:
        delete_loan(loan_id)
        return {"status": "success", "message": "Crédit supprimé."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Stats & Calculations (Dashboard + Realized/Planned reports)
@app.get("/api/stats")
async def get_financial_stats(year: Optional[int] = None):
    if year is None:
        year = datetime.now().year
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Accounts summary
    cursor.execute("SELECT id, backend_name, label, balance, type, last_sync, include_in_budget_and_list, rate FROM accounts")
    accounts = [dict(r) for r in cursor.fetchall()]
    
    # 2. Categories budget
    cursor.execute("SELECT name, type, monthly_budget FROM categories")
    categories = [dict(r) for r in cursor.fetchall()]
    
    # 2b. Month-specific budgets
    cursor.execute("SELECT category_name, month, budget FROM monthly_budgets WHERE month LIKE ?", (f"{year}-%",))
    specific_budgets = {}
    for r in cursor.fetchall():
        specific_budgets[(r["category_name"], r["month"])] = r["budget"]
    
    # 3. Transactions for the year (from Nov of previous year to Dec of current year, to account for decalage)
    cursor.execute("""
        SELECT t.date, t.amount, t.type, t.category, t.decalage, t.checked
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.date >= ? AND t.date <= ? AND a.include_in_budget_and_list = 1
    """, (f"{year-1}-11-01", f"{year}-12-31"))
    transactions = cursor.fetchall()
    
    # List of months for the current year
    months = [f"{year}-{m:02d}" for m in range(1, 13)]
    
    # Aggregate data by month
    monthly_data = {}
    for m in months:
        monthly_data[m] = {
            "income": 0.0,
            "fixed": 0.0,
            "variable": 0.0,
            "savings": 0.0,
            "details": {},
            "budgets": {c["name"]: specific_budgets.get((c["name"], m), c["monthly_budget"]) for c in categories}
        }
    
    for t in transactions:
        t_date = t["date"]
        amount = t["amount"]
        tr_type = t["type"]
        category = t["category"]
        decalage = t["decalage"]
        
        try:
            dt = datetime.strptime(t_date, "%Y-%m-%d")
        except ValueError:
            continue
            
        if decalage:
            if dt.month == 12:
                b_month = f"{dt.year + 1}-01"
            else:
                b_month = f"{dt.year}-{dt.month + 1:02d}"
        else:
            b_month = f"{dt.year}-{dt.month:02d}"
            
        if b_month not in monthly_data:
            continue
            
        abs_amount = abs(amount)
        
        if tr_type == "Revenu":
            monthly_data[b_month]["income"] += amount  # Incomes are positive
        elif tr_type == "Dépense fixe":
            monthly_data[b_month]["fixed"] += abs_amount  # Store expense as positive for reporting
        elif tr_type == "Dépense variable":
            monthly_data[b_month]["variable"] += abs_amount
        elif tr_type == "Transfert":
            # Positive amounts in transfer are savings, negative amounts are withdrawals
            monthly_data[b_month]["savings"] += amount
            
        if category:
            if category not in monthly_data[b_month]["details"]:
                monthly_data[b_month]["details"][category] = 0.0
            # For category breakdown, keep the direction of transaction, but default to positive for expenses in view
            monthly_data[b_month]["details"][category] += abs_amount

    # Sum up category budgets from DB
    budget_sums = {
        "income": sum(c["monthly_budget"] for c in categories if c["type"] == "Revenu"),
        "fixed": sum(c["monthly_budget"] for c in categories if c["type"] == "Dépense fixe"),
        "variable": sum(c["monthly_budget"] for c in categories if c["type"] == "Dépense variable"),
        "savings": sum(c["monthly_budget"] for c in categories if c["type"] == "Transfert")
    }
    
    # 4. Interest projections for Epargne tab
    cursor.execute("SELECT account_type, rate FROM savings_rates")
    savings_rates = {row["account_type"]: row["rate"] for row in cursor.fetchall()}
    
    # 5. Loan details
    cursor.execute("SELECT id, name, amount, rate, duration_months, start_date, monthly_payment, insurance, account_id FROM loan_details")
    loans = [dict(row) for row in cursor.fetchall()]
    
    # 5b. Reconstruct monthly balances and calculate monthly interests for livret accounts
    import calendar
    savings_details = []
    
    # Load all monthly savings rates overrides
    cursor.execute("SELECT account_id, year, month, rate FROM monthly_savings_rates WHERE year = ?", (year,))
    monthly_overrides = {}
    for row in cursor.fetchall():
        monthly_overrides[(row["account_id"], row["month"])] = row["rate"]
        
    for acc in accounts:
        if acc["type"] != "livret" or acc["include_in_budget_and_list"] == 0:
            continue
            
        # Get all transactions for this account
        cursor.execute("SELECT date, amount FROM transactions WHERE account_id = ? ORDER BY date DESC", (acc["id"],))
        txs = [dict(r) for r in cursor.fetchall()]
        
        # Determine base rate dynamically based on label matching against global rates
        rate_type = "Livret A"
        lbl_upper = acc["label"].upper()
        if "LEP" in lbl_upper:
            rate_type = "LEP"
        elif "LDD" in lbl_upper or "DEVELOPPEMENT DURABLE" in lbl_upper:
            rate_type = "LDD"
            
        base_rate = savings_rates.get(rate_type, 3.0)
        
        months_detail = []
        total_interest = 0.0
        current_balance = acc["balance"]
        
        for m_idx in range(1, 13):
            # Calculate the end date of this month
            last_day = calendar.monthrange(year, m_idx)[1]
            end_date_str = f"{year}-{m_idx:02d}-{last_day:02d}"
            
            # Reconstruct balance at the end of the month
            diff = sum(tx["amount"] for tx in txs if tx["date"] > end_date_str)
            month_end_balance = current_balance - diff
            
            # Get interest rate (either override or base rate)
            rate_val = monthly_overrides.get((acc["id"], m_idx), base_rate)
            
            # Calculate interest of this month
            month_interest = month_end_balance * (rate_val / 100.0) / 12.0
            
            total_interest += month_interest
            
            months_detail.append({
                "month": m_idx,
                "month_name": ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"][m_idx - 1],
                "balance": round(month_end_balance, 2),
                "rate": round(rate_val, 2),
                "interest": round(month_interest, 2)
            })
            
        # Determine rate of the current month
        current_month = datetime.now().month
        current_rate = next((m["rate"] for m in months_detail if m["month"] == current_month), base_rate)
            
        savings_details.append({
            "account_id": acc["id"],
            "label": acc["label"],
            "months": months_detail,
            "current_rate": round(current_rate, 2),
            "total_interest": round(total_interest, 2)
        })
    
    # 6. Find all available years from transactions
    cursor.execute("SELECT DISTINCT SUBSTR(date, 1, 4) as yr FROM transactions")
    available_years = [int(r["yr"]) for r in cursor.fetchall() if r["yr"]]
    current_yr = datetime.now().year
    if current_yr not in available_years:
        available_years.append(current_yr)
    if (current_yr + 1) not in available_years:
        available_years.append(current_yr + 1)
    available_years = sorted(list(set(available_years)), reverse=True)
    
    conn.close()
    
    return {
        "accounts": accounts,
        "categories": categories,
        "monthly_data": monthly_data,
        "budget_sums": budget_sums,
        "savings_rates": savings_rates,
        "loans": loans,
        "savings_details": savings_details,
        "available_years": available_years
    }

# Sync Logs
@app.get("/api/logs")
async def get_logs_history(limit: int = 100):
    return get_logs(limit)

@app.post("/api/logs/clear")
async def clear_logs_history():
    clear_logs()
    add_log("INFO", "Historique des journaux réinitialisé.")
    return {"status": "success", "message": "Journaux vidés."}

@app.post("/api/sync")
async def trigger_manual_sync(background_tasks: BackgroundTasks):
    global is_sync_running
    if is_sync_running:
        return JSONResponse(status_code=400, content={"status": "error", "message": "La synchronisation est déjà en cours d'exécution."})
    
    background_tasks.add_task(run_sync_task)
    return {"status": "success", "message": "Synchronisation démarrée en arrière-plan."}

@app.post("/api/woob/update")
async def trigger_woob_update(background_tasks: BackgroundTasks):
    global is_update_running
    if is_update_running:
        return JSONResponse(status_code=400, content={"status": "error", "message": "La mise à jour des modules est déjà en cours."})
    
    background_tasks.add_task(run_update_task)
    return {"status": "success", "message": "Mise à jour des modules Woob lancée en arrière-plan."}

# Serve Frontend static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
 
    @app.get("/")
    async def read_index():
        return FileResponse(os.path.join(static_dir, "index.html"))
else:
    @app.get("/")
    async def read_index():
        return {"message": "Server is running, but app/static/ folder is missing."}

if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host=host, port=port)
