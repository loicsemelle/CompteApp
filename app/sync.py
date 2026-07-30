import os
import re
import json
import hashlib
import subprocess
import traceback
from datetime import datetime
from decimal import Decimal

from woob.core import Woob
from woob.capabilities.bank import CapBank
from woob.exceptions import ActionNeeded, BrowserIncorrectPassword

from app.db import get_backends, get_setting, set_setting, add_log, save_account, save_transactions, get_db_connection

def update_woob_modules():
    """Run woob update to download or update bank modules."""
    try:
        add_log("INFO", "Début de la mise à jour des modules Woob...")
        result = subprocess.run(
            "yes | woob update",
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
        add_log("SUCCESS", "Modules Woob mis à jour avec succès !", result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        error_msg = f"Erreur lors de la mise à jour de Woob (Code {e.returncode})"
        details = f"STDOUT:\n{e.stdout}\n\nSTDERR:\n{e.stderr}"
        add_log("FAILED", error_msg, details)
        return False
    except Exception as e:
        add_log("FAILED", f"Erreur système lors de la mise à jour Woob: {str(e)}", traceback.format_exc())
        return False

def run_sync():
    """Main synchronization logic storing directly into SQLite."""
    sync_id = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    add_log("IN_PROGRESS", f"Démarrage de la synchronisation ({sync_id})")
    
    # 1. Retrieve active bank backends from Database
    db_backends = get_backends()
    active_backends = [b for b in db_backends if b["active"]]
    
    if not active_backends:
        add_log("SUCCESS", "Aucun compte bancaire actif configuré. Synchronisation terminée (0 transactions ajoutées).")
        set_setting("last_sync_status", "SUCCESS")
        set_setting("last_sync_time", datetime.now().isoformat())
        return True

    # 2. Initialize Woob
    workdir = os.environ.get("WOOB_WORKDIR", "/data/woob")
    datadir = os.environ.get("WOOB_DATADIR", "/data/woob")
    
    try:
        os.makedirs(workdir, exist_ok=True)
        os.makedirs(datadir, exist_ok=True)
        w = Woob(workdir=workdir, datadir=datadir)
    except Exception as e:
        add_log("FAILED", f"Erreur lors de l'initialisation de Woob : {str(e)}", traceback.format_exc())
        return False

    # 3. Align Woob backend config with our SQLite DB
    try:
        configured_backends = {name: module for name, module, _ in w.backends_config.iter_backends()}
        db_names = {b["name"] for b in active_backends}
        for name, module in configured_backends.items():
            db_backend = next((b for b in active_backends if b["name"] == name), None)
            if db_backend is None or db_backend["module"] != module:
                add_log("INFO", f"Suppression du backend Woob obsolète ou erroné : {name} (module: {module})...")
                w.backends_config.remove_backend(name)
                
        for b in active_backends:
            name = b["name"]
            module = b["module"]
            params = b["config"]
            
            try:
                w.load_or_install_module(module)
            except Exception as mod_err:
                add_log("FAILED", f"Impossible de charger ou installer le module '{module}' : {str(mod_err)}")
                continue
            
            if w.backends_config.backend_exists(name):
                w.backends_config.edit_backend(name, params)
            else:
                w.backends_config.add_backend(name, module, params)
    except Exception as e:
        add_log("FAILED", f"Erreur lors de la configuration des backends Woob : {str(e)}", traceback.format_exc())
        return False

    # 4. Load CapBank backends in Woob
    try:
        w.load_backends(CapBank)
    except Exception as e:
        add_log("FAILED", f"Erreur lors du chargement des modules bancaires : {str(e)}", traceback.format_exc())
        return False

    # 5. Fetch and sync accounts and transactions
    backends_errors = []
    total_accounts_saved = 0
    total_transactions_saved = 0
    
    # Woob account type mapping to our SQLite enum
    acc_type_map = {
        0: "courant",       # TYPE_UNKNOWN
        1: "courant",       # TYPE_CHECKING
        2: "livret",        # TYPE_SAVINGS
        3: "livret",        # TYPE_DEPOSIT
        4: "pret",          # TYPE_LOAN
        5: "investissement", # TYPE_MARKET
        6: "courant",       # TYPE_JOINT
        7: "courant"        # TYPE_CARD
    }
    
    for name, backend in w.backend_instances.items():
        if not isinstance(backend, CapBank):
            continue
            
        add_log("INFO", f"Récupération des données pour le compte : {name}...")
        try:
            for account in backend.iter_accounts():
                account_label = f"{name} - {account.label}"
                add_log("INFO", f"Lecture du compte : {account_label} ({account.id})")
                
                # Save Account Info
                balance_val = float(account.balance) if isinstance(account.balance, (int, float, Decimal)) else 0.0
                acc_type_code = int(account.type) if hasattr(account, 'type') and account.type is not None else 1
                acc_type = acc_type_map.get(acc_type_code, "courant")
                
                # Refine based on name for LEP/LDD if they are labeled
                label_upper = account.label.upper()
                if "LIVRET A" in label_upper:
                    acc_type = "livret"
                elif "LDD" in label_upper or "DEVELOPPEMENT DURABLE" in label_upper:
                    acc_type = "livret"
                elif "LEP" in label_upper:
                    acc_type = "livret"
                elif "PEA" in label_upper or "PORTFEUILLE" in label_upper or "ORD" in label_upper:
                    acc_type = "investissement"
                elif "PRÊT" in label_upper or "CREDIT" in label_upper:
                    acc_type = "pret"
                
                save_account(account.id, name, account_label, balance_val, acc_type)
                total_accounts_saved += 1
                
                # Delete all pending/coming transactions for this account in the database first
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM transactions WHERE account_id = ? AND coming = 1", (account.id,))
                conn.commit()
                conn.close()

                # Load existing transaction IDs for this account
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT id FROM transactions WHERE account_id = ?", (account.id,))
                existing_ids = {row["id"] for row in cursor.fetchall()}
                conn.close()
                
                incoming_sig_counts = {}
                duplicate_count = 0
                
                # Fetch Transactions for this Account
                transactions_to_save = []
                try:
                    for tr in backend.iter_history(account):
                        # Formatting dates
                        tr_date = ""
                        if hasattr(tr, 'date') and tr.date:
                            tr_date = tr.date.strftime("%Y-%m-%d") if hasattr(tr.date, 'strftime') else str(tr.date)
                        
                        tr_rdate = ""
                        if hasattr(tr, 'rdate') and tr.rdate:
                            tr_rdate = tr.rdate.strftime("%Y-%m-%d") if hasattr(tr.rdate, 'strftime') else str(tr.rdate)
                        
                        # Format amount
                        amount_val = float(tr.amount) if isinstance(tr.amount, (int, float, Decimal)) else float(str(tr.amount))
                        
                        # Determine ID: use Woob's native ID if available, otherwise stable signature hash
                        if hasattr(tr, 'id') and tr.id:
                            tr_id = tr.id
                        else:
                            key = (tr_date, tr.label or "", amount_val)
                            count = incoming_sig_counts.get(key, 0)
                            incoming_sig_counts[key] = count + 1
                            hash_input = f"{account.id}_{tr_date}_{amount_val}_{tr.label or ''}_{count}"
                            tr_id = "stable_" + hashlib.md5(hash_input.encode('utf-8')).hexdigest()[:16]
                        
                        # Check if this transaction or any split part of it is already in the database
                        is_duplicate = (tr_id in existing_ids) or (f"{tr_id}_split_2" in existing_ids)
                        
                        # Stop fetching history if we hit transactions already in database
                        if is_duplicate:
                            duplicate_count += 1
                            if duplicate_count >= 5: # Break after 5 duplicates to be safe against minor sorting/pending shifts
                                add_log("INFO", f"Synchronisation optimisée : transactions déjà présentes détectées pour {account.id}. Fin de la lecture.")
                                break
                        else:
                            duplicate_count = 0

                        # Limit first sync to 12 months history
                        if tr_date:
                            try:
                                t_dt = datetime.strptime(tr_date, "%Y-%m-%d")
                                days_old = (datetime.now() - t_dt).days
                                if days_old > 365:
                                    add_log("INFO", f"Limite d'historique de 12 mois atteinte pour {account.id}. Fin de la lecture.")
                                    break
                            except ValueError:
                                pass
                        
                        # Format amount
                        amount_val = float(tr.amount) if isinstance(tr.amount, (int, float, Decimal)) else float(str(tr.amount))
                        
                        # Format coming flag
                        coming_val = getattr(tr, 'coming', False)
                        
                        transactions_to_save.append({
                            "id": tr_id,
                            "account_id": account.id,
                            "date": tr_date,
                            "rdate": tr_rdate,
                            "label": tr.label or "",
                            "amount": amount_val,
                            "category": "", # Will be auto-categorized by database helper
                            "type": "",
                            "note": "",
                            "checked": 0,
                            "decalage": 0,
                            "coming": 1 if coming_val else 0
                        })
                        
                    if transactions_to_save:
                        saved_count = save_transactions(transactions_to_save)
                        total_transactions_saved += saved_count
                        
                except ActionNeeded as e:
                    auth_err = f"Authentification Forte requise pour {name} (Compte {account.id}) : {str(e)}"
                    backends_errors.append(auth_err)
                    add_log("FAILED", auth_err, f"URL de validation : {getattr(e, 'url', 'N/A')}\n\nDétails : {str(e)}")
                except Exception as e:
                    acc_err = f"Erreur lors de la lecture de l'historique de {account_label} : {str(e)}"
                    if acc_type_code in (3, 4, 5):
                        add_log("INFO", f"Note: Impossible de récupérer l'historique des transactions pour {account_label} ({str(e)}). Le solde a été mis à jour.")
                    else:
                        backends_errors.append(acc_err)
                        failed_url = "N/A"
                        if hasattr(e, 'response') and e.response is not None and hasattr(e.response, 'url'):
                            failed_url = e.response.url
                        elif 'backend' in locals() and hasattr(backend, 'browser') and getattr(backend.browser, 'url', None):
                            failed_url = backend.browser.url
                        add_log("FAILED", acc_err, f"URL tentée : {failed_url}\n\n{traceback.format_exc()}")
                    
        except ActionNeeded as e:
            auth_err = f"Authentification Forte requise pour {name} : {str(e)}"
            backends_errors.append(auth_err)
            add_log("FAILED", auth_err, f"URL de validation : {getattr(e, 'url', 'N/A')}\n\nDétails : {str(e)}")
        except BrowserIncorrectPassword as e:
            pwd_err = f"Identifiants incorrects pour {name} : {str(e)}"
            backends_errors.append(pwd_err)
            add_log("FAILED", pwd_err)
        except Exception as e:
            err_str = str(e)
            is_temp_server_error = any(code in err_str for code in ("503 Server Error", "502 Bad Gateway", "504 Gateway Timeout", "500 Internal Server Error", "Connection timed out", "TimeoutError", "Service Unavailable"))
            
            failed_url = "N/A"
            if hasattr(e, 'response') and e.response is not None and hasattr(e.response, 'url'):
                failed_url = e.response.url
            elif 'backend' in locals() and hasattr(backend, 'browser') and getattr(backend.browser, 'url', None):
                failed_url = backend.browser.url
            
            back_err = f"Erreur lors de l'accès à la banque {name} : {err_str}"
            if is_temp_server_error:
                add_log("INFO", f"Note: La banque {name} est temporairement inaccessible ({err_str}). URL tentée : {failed_url}. Les autres banques ont été lues avec succès.")
            else:
                backends_errors.append(back_err)
                add_log("FAILED", back_err, f"URL tentée : {failed_url}\n\n{traceback.format_exc()}")

    # Log summary
    if backends_errors:
        add_log("FAILED", f"Synchronisation terminée avec des erreurs. {total_accounts_saved} comptes lus, {total_transactions_saved} transactions synchronisées.")
        set_setting("last_sync_status", "PARTIAL_FAILED")
        set_setting("last_sync_time", datetime.now().isoformat())
        return False
    else:
        add_log("SUCCESS", f"Synchronisation réussie ! {total_accounts_saved} comptes lus, {total_transactions_saved} transactions enregistrées dans la base de données locale.")
        set_setting("last_sync_status", "SUCCESS")
        set_setting("last_sync_time", datetime.now().isoformat())
        return True
